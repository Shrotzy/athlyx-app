import { describe, expect, it } from 'vitest';

import {
  criteriaStatus,
  evaluateSession,
  landingQuality,
  lowerIsBetterScore,
  lsi,
  median,
} from '../shared/scoring.js';
import { isValidTrial, validateSessionPayload } from '../shared/validation.js';
import { TESTS, LEGS } from '../shared/constants.js';

/** Build a run of valid hop trials. */
function hops(test, leg, distances, extra = {}) {
  return distances.map((distance, index) => ({
    test,
    leg,
    trialNo: index + 1,
    valid: true,
    voidReasons: [],
    metrics: { hopDistanceCm: distance, ...extra },
  }));
}

/** Build a run of valid landing trials. */
function landings(leg, valgus, trunk) {
  return valgus.map((value, index) => ({
    test: TESTS.SINGLE_LEG_LANDING,
    leg,
    trialNo: index + 1,
    valid: true,
    voidReasons: [],
    metrics: { valgusDeg: value, trunkLeanDeg: trunk[index] },
  }));
}

/** The worked example from section 2 of the requirements. */
function workedExample({ noisy = false } = {}) {
  return [
    ...hops(TESTS.SINGLE_HOP, LEGS.OPERATED, [156, 158, 154], { kneeFlexionDeg: 65, forwardTrunkLeanDeg: 22 }),
    ...hops(TESTS.SINGLE_HOP, LEGS.HEALTHY, [170, 172, 168], { kneeFlexionDeg: 75, forwardTrunkLeanDeg: 20 }),
    ...hops(TESTS.CROSSOVER_HOP, LEGS.OPERATED, [410, 412, 408]),
    ...hops(TESTS.CROSSOVER_HOP, LEGS.HEALTHY, [460, 462, 458]),
    ...landings(LEGS.OPERATED, [11, 11, 11], [9, 9, 9]),
    ...landings(LEGS.HEALTHY, [4, 4, 4], [6, 6, 6]),
  ];
}

describe('median', () => {
  it('averages the middle pair for even counts', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('ignores non-numbers and returns null for empty input', () => {
    expect(median([10, null, undefined, 12, Number.NaN])).toBe(11);
    expect(median([])).toBeNull();
  });
});

describe('limb symmetry index', () => {
  it('expresses the operated leg as a percentage of the healthy leg', () => {
    expect(lsi(156, 170)).toBeCloseTo(91.76, 2);
  });

  it('caps at 100 when the operated leg measured further', () => {
    expect(lsi(200, 180)).toBe(100);
  });

  it('returns null when the healthy leg has no usable value', () => {
    expect(lsi(150, 0)).toBeNull();
  });
});

describe('landing markers', () => {
  it('applies the 5 degree buffer for lower-is-better markers', () => {
    expect(lowerIsBetterScore(4, 11)).toBeCloseTo(56.25, 2);
    expect(lowerIsBetterScore(6, 9)).toBeCloseTo(78.571, 2);
  });

  it('weights valgus 70% and trunk 30%', () => {
    const quality = landingQuality({
      operatedValgus: 11,
      healthyValgus: 4,
      operatedTrunkLean: 9,
      healthyTrunkLean: 6,
    });
    expect(quality.valgusScore).toBeCloseTo(56.25, 2);
    expect(quality.trunkScore).toBeCloseTo(78.571, 2);
    expect(quality.quality).toBeCloseTo(62.95, 2);
  });

  it('scores 100 for both markers when the legs match', () => {
    const quality = landingQuality({
      operatedValgus: 6,
      healthyValgus: 6,
      operatedTrunkLean: 5,
      healthyTrunkLean: 5,
    });
    expect(quality.quality).toBeCloseTo(100, 5);
  });
});

describe('evaluateSession — worked example', () => {
  const results = evaluateSession({ trials: workedExample() });

  it('scores each test from the median of valid trials', () => {
    expect(results.scores.singleHop).toBe(91.8);
    expect(results.scores.crossoverHop).toBe(89.1);
    expect(results.scores.landing).toBe(62.9);
  });

  it('exposes the landing markers that drove the landing score', () => {
    const landing = results.tests[TESTS.SINGLE_LEG_LANDING];
    expect(landing.markers.valgusScore).toBe(56.3);
    expect(landing.markers.trunkScore).toBe(78.6);
  });

  it('reports the supporting flexion ratio but keeps it out of the status', () => {
    expect(results.supporting.kneeFlexionDeg.operated).toBe(65);
    expect(results.supporting.kneeFlexionDeg.healthy).toBe(75);
    expect(results.supporting.kneeFlexionDeg.ratio).toBe(86.7);
    expect(results.supporting.forwardTrunkLeanDeg.ratio).toBe(110);
  });

  it('averages the three test scores into the trend score', () => {
    expect(results.trendScore).toBe(81.3);
  });

  it('is below target because the landing marker is under its floor', () => {
    expect(results.status).toBe('below');
    expect(results.responsible.some((item) => item.marker === 'valgus')).toBe(true);
    expect(results.notes.join(' ')).toMatch(/Crossover hop score 89.1%/);
  });
});

describe('criteria status rules', () => {
  const base = { singleHop: 95, crossoverHop: 92, landing: 93, valgusScore: 90, trunkScore: 100 };

  it('meets target when every score is at least 90', () => {
    expect(criteriaStatus(base).status).toBe('meets');
    expect(criteriaStatus({ ...base, singleHop: 90 }).status).toBe('meets');
  });

  it('is borderline between 85 and 90', () => {
    expect(criteriaStatus({ ...base, singleHop: 89.9 }).status).toBe('borderline');
    expect(criteriaStatus({ ...base, crossoverHop: 85 }).status).toBe('borderline');
  });

  it('is below target under 85, naming the responsible test', () => {
    const result = criteriaStatus({ ...base, landing: 84.9 });
    expect(result.status).toBe('below');
    expect(result.responsible[0].test).toBe(TESTS.SINGLE_LEG_LANDING);
  });

  it('is below target when a landing marker falls under its floor even if scores look fine', () => {
    const result = criteriaStatus({ ...base, valgusScore: 84.9 });
    expect(result.status).toBe('below');
    expect(result.responsible[0].marker).toBe('valgus');
  });

  it('treats a noisy measurement as borderline', () => {
    expect(criteriaStatus({ ...base, noisy: true }).status).toBe('borderline');
  });

  it('is insufficient data when a score is missing', () => {
    expect(criteriaStatus({ ...base, crossoverHop: null }).status).toBe('insufficient');
  });
});

describe('trial handling', () => {
  it('needs three valid trials per leg before scoring', () => {
    const trials = [
      ...hops(TESTS.SINGLE_HOP, LEGS.OPERATED, [150, 152]),
      ...hops(TESTS.SINGLE_HOP, LEGS.HEALTHY, [170, 172, 168]),
      ...hops(TESTS.CROSSOVER_HOP, LEGS.OPERATED, [400, 401, 399]),
      ...hops(TESTS.CROSSOVER_HOP, LEGS.HEALTHY, [450, 451, 449]),
      ...landings(LEGS.OPERATED, [6, 6, 6], [5, 5, 5]),
      ...landings(LEGS.HEALTHY, [5, 5, 5], [5, 5, 5]),
    ];
    const results = evaluateSession({ trials });
    expect(results.status).toBe('insufficient');
    expect(results.tests[TESTS.SINGLE_HOP].score).toBeNull();
    expect(results.notes.join(' ')).toMatch(/2 valid scored trials, 3 needed/);
  });

  it('excludes voided trials from the median', () => {
    const trials = [
      ...hops(TESTS.SINGLE_HOP, LEGS.OPERATED, [100, 150, 152, 148]),
      ...hops(TESTS.SINGLE_HOP, LEGS.HEALTHY, [160, 162, 158]),
      ...hops(TESTS.CROSSOVER_HOP, LEGS.OPERATED, [200, 200, 200]),
      ...hops(TESTS.CROSSOVER_HOP, LEGS.HEALTHY, [200, 200, 200]),
      ...landings(LEGS.OPERATED, [6, 6, 6], [5, 5, 5]),
      ...landings(LEGS.HEALTHY, [6, 6, 6], [5, 5, 5]),
    ];
    trials[0] = { ...trials[0], valid: false, voidReasons: ['landing-not-held'] };

    const summary = evaluateSession({ trials }).tests[TESTS.SINGLE_HOP].legs.operated;
    expect(summary.validCount).toBe(3);
    expect(summary.metrics.hopDistanceCm).toBe(150);
    expect(summary.voidedReasons['landing-not-held']).toBe(1);
  });

  it('treats a trial with a void reason as invalid even if the flag says valid', () => {
    expect(isValidTrial({ valid: true, voidReasons: ['tracking-lost'] })).toBe(false);
  });
});

describe('payload validation', () => {
  it('accepts a well-formed trial list', () => {
    expect(validateSessionPayload({ trials: workedExample() }).ok).toBe(true);
  });

  it('rejects valid trials with missing required measurements', () => {
    const broken = [
      {
        test: TESTS.SINGLE_HOP,
        leg: LEGS.OPERATED,
        trialNo: 1,
        valid: true,
        voidReasons: [],
        metrics: {},
      },
    ];
    const result = validateSessionPayload({ trials: broken });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/hopDistanceCm/);
  });

  it('does not require measurements for voided trials', () => {
    const voided = [
      {
        test: TESTS.SINGLE_HOP,
        leg: LEGS.OPERATED,
        trialNo: 1,
        valid: false,
        voidReasons: ['tracking-lost'],
        metrics: {},
      },
    ];
    expect(validateSessionPayload({ trials: voided }).ok).toBe(true);
  });
});
