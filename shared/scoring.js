/**
 * ATHLYx scoring engine — section 2 of the requirements.
 *
 * Pure functions, no I/O, no AI. Everything here is deterministic and every
 * user-facing number can be traced back to the medians of valid trials.
 *
 *   score = operated / healthy x 100  (hop tests, capped at 100)
 *   marker = (healthy + 5) / (operated + 5) x 100  (lower-is-better, capped at 100)
 *   landing quality = 0.70 x valgus + 0.30 x trunk
 */

import {
  LEGS,
  LEG_LIST,
  PARAMS,
  STATUS,
  STATUS_LABEL,
  TESTS,
  TEST_META,
  TEST_LIST,
  HOP_TESTS,
} from './constants.js';
import { isValidTrial, normalizeVoidReasons } from './validation.js';

const SCORE_KEYS = {
  [TESTS.SINGLE_HOP]: 'singleHop',
  [TESTS.CROSSOVER_HOP]: 'crossoverHop',
  [TESTS.SINGLE_LEG_LANDING]: 'landing',
};

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function round(value, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Median of the valid trials. Returns null when there is nothing to average. */
export function median(values) {
  const numbers = (values || []).filter(isFiniteNumber);
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Limb Symmetry Index: operated as a percentage of the healthy leg, capped at 100. */
export function lsi(operated, healthy) {
  if (!isFiniteNumber(operated) || !isFiniteNumber(healthy) || healthy <= 0) return null;
  return clamp((operated / healthy) * 100, 0, 100);
}

/**
 * Score for a "lower is better" landing marker (degrees).
 * The +5 degree buffer keeps the ratio defined when alignment is near perfect.
 */
export function lowerIsBetterScore(healthyDeg, operatedDeg, buffer = PARAMS.lowerIsBetterBuffer) {
  if (!isFiniteNumber(healthyDeg) || !isFiniteNumber(operatedDeg)) return null;
  const denominator = operatedDeg + buffer;
  if (denominator <= 0) return null;
  return clamp(((healthyDeg + buffer) / denominator) * 100, 0, 100);
}

/** Landing quality = 0.70 x valgus score + 0.30 x trunk score. */
export function landingQuality({ operatedValgus, healthyValgus, operatedTrunkLean, healthyTrunkLean }) {
  const valgusScore = lowerIsBetterScore(healthyValgus, operatedValgus);
  const trunkScore = lowerIsBetterScore(healthyTrunkLean, operatedTrunkLean);
  if (valgusScore == null || trunkScore == null) {
    return { valgusScore, trunkScore, quality: null };
  }
  const quality = valgusScore * PARAMS.valgusWeight + trunkScore * PARAMS.trunkWeight;
  return { valgusScore, trunkScore, quality: clamp(quality, 0, 100) };
}

/**
 * Criteria status — fixed rules only, never a model.
 *
 * meets        every test score >= 90 and neither marker below its 85 floor
 * borderline   any test score in [85, 90) or the measurement is flagged noisy
 * below        any test score < 85, or either marker below the 85 floor
 * insufficient too few valid trials or unreliable tracking
 */
export function criteriaStatus({ singleHop, landing, valgusScore, trunkScore, noisy = false, missingReasons = [] }) {
  // Only the tests in the protocol can hold the status back.
  const scoreByTest = { [TESTS.SINGLE_HOP]: singleHop, [TESTS.SINGLE_LEG_LANDING]: landing };
  const entries = TEST_LIST.map((test) => ({
    key: test,
    label: TEST_META[test].shortLabel,
    score: scoreByTest[test],
  }));

  const incomplete =
    entries.some((entry) => !isFiniteNumber(entry.score)) ||
    !isFiniteNumber(valgusScore) ||
    !isFiniteNumber(trunkScore);

  if (incomplete) {
    return {
      status: STATUS.INSUFFICIENT,
      responsible: [],
      notes: [
        ...missingReasons,
        'Too few valid trials or unreliable tracking to score every test. A re-test is suggested.',
      ].filter(Boolean),
    };
  }

  const responsible = [];
  const notes = [];
  const floor = PARAMS.markerFloor;

  for (const entry of entries) {
    if (entry.score < PARAMS.borderlineLow) {
      responsible.push({
        test: entry.key,
        kind: 'test-score',
        reason: `${entry.label} score ${round(entry.score)}% is below ${PARAMS.borderlineLow}%.`,
      });
    }
  }

  if (valgusScore < floor) {
    responsible.push({
      test: TESTS.SINGLE_LEG_LANDING,
      kind: 'marker',
      marker: 'valgus',
      reason: `Valgus score ${round(valgusScore)}% is below the ${floor}% marker floor (inward knee collapse on landing).`,
    });
  }
  if (trunkScore < floor) {
    responsible.push({
      test: TESTS.SINGLE_LEG_LANDING,
      kind: 'marker',
      marker: 'trunk',
      reason: `Trunk score ${round(trunkScore)}% is below the ${floor}% marker floor (lateral trunk lean on landing).`,
    });
  }

  for (const entry of entries) {
    if (entry.score >= PARAMS.borderlineLow && entry.score < PARAMS.targetScore) {
      notes.push(
        `${entry.label} score ${round(entry.score)}% is in the borderline band (${PARAMS.borderlineLow}–${PARAMS.targetScore}%).`,
      );
    }
  }
  if (noisy) {
    notes.push('Measurements were flagged as noisy this session — treat small differences with caution.');
  }

  let status;
  if (responsible.length > 0) {
    status = STATUS.BELOW;
  } else if (notes.length > 0) {
    status = STATUS.BORDERLINE;
  } else {
    status = STATUS.MEETS;
  }

  if (status === STATUS.BELOW) {
    notes.push('A re-test after further rehabilitation is suggested before the next review.');
  }

  return { status, responsible, notes };
}

/**
 * Collapse one test + leg's trials into a median summary.
 */
export function summarizeTrials(trials, test, leg) {
  const forLeg = (trials || []).filter((trial) => trial.test === test && trial.leg === leg);
  const valid = forLeg.filter(isValidTrial);
  const numbers = (key) => valid.map((trial) => trial.metrics?.[key]).filter(isFiniteNumber);
  const metrics = {
    hopDistanceCm: median(numbers('hopDistanceCm')),
    kneeFlexionDeg: median(numbers('kneeFlexionDeg')),
    forwardTrunkLeanDeg: median(numbers('forwardTrunkLeanDeg')),
    valgusDeg: median(numbers('valgusDeg')),
    trunkLeanDeg: median(numbers('trunkLeanDeg')),
  };

  return {
    attempts: forLeg.length,
    validCount: valid.length,
    scoredCount: Math.min(valid.length, PARAMS.scoredTrials),
    insufficient: valid.length < PARAMS.minValidTrials,
    metrics,
    voidedReasons: forLeg
      .flatMap((trial) => normalizeVoidReasons(trial.voidReasons))
      .reduce((acc, reason) => ({ ...acc, [reason]: (acc[reason] || 0) + 1 }), {}),
  };
}

/**
 * Evaluate a whole check-in.
 *
 * @param {object} input
 * @param {Array<{test:string, leg:string, trialNo:number, valid?:boolean, voidReasons?:string[], metrics:object}>} input.trials
 * @param {boolean} [input.noisy] tracking was unreliable this session
 * @returns complete, explainable results object (safe to store as JSON)
 */
export function evaluateSession({ trials = [], noisy = false } = {}) {
  const missingReasons = [];
  const tests = {};

  for (const test of TEST_LIST) {
    const meta = TEST_META[test];
    const legs = {};
    for (const leg of LEG_LIST) {
      legs[leg] = summarizeTrials(trials, test, leg);
      if (legs[leg].insufficient) {
        missingReasons.push(
          `${meta.shortLabel} (${leg === LEGS.OPERATED ? 'operated' : 'healthy'} leg): ${
            legs[leg].validCount
          } valid scored trial${legs[leg].validCount === 1 ? '' : 's'}, ${PARAMS.minValidTrials} needed.`,
        );
      }
    }

    const operated = legs[LEGS.OPERATED].metrics;
    const healthy = legs[LEGS.HEALTHY].metrics;
    const incomplete = legs[LEGS.OPERATED].insufficient || legs[LEGS.HEALTHY].insufficient;

    const entry = {
      key: test,
      label: meta.label,
      shortLabel: meta.shortLabel,
      cameraView: meta.cameraView,
      scoredBy: meta.scoredBy,
      insufficient: incomplete,
      legs,
      score: null,
      markers: null,
    };

    if (!incomplete) {
      if (HOP_TESTS.includes(test)) {
        entry.score = round(lsi(operated.hopDistanceCm, healthy.hopDistanceCm));
      } else {
        const quality = landingQuality({
          operatedValgus: operated.valgusDeg,
          healthyValgus: healthy.valgusDeg,
          operatedTrunkLean: operated.trunkLeanDeg,
          healthyTrunkLean: healthy.trunkLeanDeg,
        });
        entry.score = round(quality.quality);
        entry.markers = {
          valgusScore: round(quality.valgusScore),
          trunkScore: round(quality.trunkScore),
        };
      }
    }

    tests[test] = entry;
  }

  // Supporting observations from the side-view hop landings (not part of status).
  const supporting = {
    kneeFlexionDeg: supportingFor(trials, 'kneeFlexionDeg'),
    forwardTrunkLeanDeg: supportingFor(trials, 'forwardTrunkLeanDeg'),
  };

  const scores = {
    singleHop: tests[TESTS.SINGLE_HOP].score,
    // Always null for sessions recorded after the crossover hop was dropped.
    crossoverHop: tests[TESTS.CROSSOVER_HOP]?.score ?? null,
    landing: tests[TESTS.SINGLE_LEG_LANDING].score,
  };

  const status = criteriaStatus({
    ...scores,
    valgusScore: tests[TESTS.SINGLE_LEG_LANDING].markers?.valgusScore,
    trunkScore: tests[TESTS.SINGLE_LEG_LANDING].markers?.trunkScore,
    noisy,
    missingReasons,
  });

  // The trend score is the average of the protocol's test scores. It is shown as
  // a line across sessions and never decides the criteria status.
  const trendValues = [scores.singleHop, scores.landing].filter(isFiniteNumber);
  const trendScore =
    trendValues.length === TEST_LIST.length
      ? round(trendValues.reduce((sum, value) => sum + value, 0) / trendValues.length)
      : null;

  return {
    protocol: {
      targetScore: PARAMS.targetScore,
      borderlineBand: [PARAMS.borderlineLow, PARAMS.borderlineHigh],
      markerFloor: PARAMS.markerFloor,
      landingWeights: [PARAMS.valgusWeight, PARAMS.trunkWeight],
      buffer: PARAMS.lowerIsBetterBuffer,
      minValidTrials: PARAMS.minValidTrials,
    },
    tests,
    scores,
    supporting,
    trendScore,
    noisy: Boolean(noisy),
    status: status.status,
    statusLabel: STATUS_LABEL[status.status],
    responsible: status.responsible,
    notes: status.notes,
    trialSummary: {
      submitted: trials.length,
      valid: trials.filter(isValidTrial).length,
      voided: trials.filter((trial) => !isValidTrial(trial)).length,
    },
  };
}

function supportingFor(trials, metricKey) {
  const out = {};
  for (const leg of LEG_LIST) {
    const values = trials
      .filter((trial) => trial.leg === leg && HOP_TESTS.includes(trial.test) && isValidTrial(trial))
      .map((trial) => trial.metrics?.[metricKey])
      .filter(isFiniteNumber);
    out[leg] = round(median(values));
  }
  const operated = out[LEGS.OPERATED];
  const healthy = out[LEGS.HEALTHY];
  out.ratio = isFiniteNumber(operated) && isFiniteNumber(healthy) && healthy > 0
    ? round((operated / healthy) * 100)
    : null;
  return out;
}

/** Convenience for the therapist's athlete list: one line of plain language. */
export function summarizeStatusForList(results) {
  if (!results) return 'No check-ins yet';
  const label = STATUS_LABEL[results.status] || results.status;
  if (results.status === STATUS.INSUFFICIENT) return `${label}`;
  const named = (results.responsible || []).map((item) => item.reason).join(' ');
  return named ? `${label} — ${named}` : label;
}
