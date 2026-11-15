import { describe, expect, it } from 'vitest';

import { frontalValgusDeg, LandingTrialDetector } from '../src/lib/measure.js';
import { normalizeTrialMetrics, validateSessionPayload } from '../shared/validation.js';

/**
 * A front-view skeleton. `kneeX` is placed relative to the straight hip-to-ankle
 * line, so a value above that line is inward (valgus) and below is outward.
 */
function frame({ kneeX, hipY = 0.4, ankleY = 0.8 } = {}) {
  return {
    leftHip: { x: 0.45, y: hipY, visible: true },
    rightHip: { x: 0.55, y: hipY, visible: true },
    leftShoulder: { x: 0.4, y: 0.2, visible: true },
    rightShoulder: { x: 0.6, y: 0.2, visible: true },
    leftKnee: { x: kneeX, y: 0.6, visible: true },
    leftAnkle: { x: 0.5, y: ankleY, visible: true },
    rightAnkle: { x: 0.58, y: ankleY, visible: true },
  };
}

describe('frontal valgus is signed', () => {
  it('is positive when the knee falls toward the midline', () => {
    // Knee inside the hip-to-ankle line (toward the body centre at x=0.5).
    expect(frontalValgusDeg({ x: 0.45, y: 0.4 }, { x: 0.56, y: 0.6 }, { x: 0.5, y: 0.8 }, 0.5)).toBeGreaterThan(0);
  });

  it('is negative when the knee tracks outside the line', () => {
    expect(
      frontalValgusDeg({ x: 0.45, y: 0.4 }, { x: 0.38, y: 0.6 }, { x: 0.5, y: 0.8 }, 0.5),
    ).toBeLessThan(0);
  });
});

describe('landing detector never reports negative valgus', () => {
  it('clamps a knee that tracks outside the line to zero', () => {
    const detector = new LandingTrialDetector({ side: 'left' });
    let time = 0;
    // Calibrate standing tall, then drop the hips to start the landing.
    for (let index = 0; index < 20; index += 1) {
      detector.push(frame({ kneeX: 0.38 }), (time += 33));
    }
    for (let index = 0; index < 20; index += 1) {
      detector.push(frame({ kneeX: 0.38, hipY: 0.5, ankleY: 0.8 }), (time += 33));
    }
    expect(detector.peakValgus).toBeGreaterThanOrEqual(0);
    expect(detector.peakValgus).toBe(0);
  });
});

describe('metric ranges', () => {
  const trial = (metrics) => ({
    trials: [
      {
        test: 'single-leg-landing',
        leg: 'operated',
        trialNo: 1,
        valid: true,
        voidReasons: [],
        metrics,
      },
    ],
  });

  it('accepts a landing trial whose valgus is zero', () => {
    expect(validateSessionPayload(trial({ valgusDeg: 0, trunkLeanDeg: 4 })).ok).toBe(true);
  });

  it('rejects a negative valgus with a message that names the range', () => {
    const result = validateSessionPayload(trial({ valgusDeg: -3.2, trunkLeanDeg: 4 }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/valgusDeg must be between 0 and 90, but was -3.2/);
  });

  it('clamps a negative magnitude captured before the fix, so the session is not lost', () => {
    const normalized = normalizeTrialMetrics({
      test: 'single-leg-landing',
      leg: 'operated',
      trialNo: 9,
      valid: true,
      voidReasons: [],
      metrics: { valgusDeg: -3.2, trunkLeanDeg: -1, hopDistanceCm: 120 },
    });
    expect(normalized.metrics).toEqual({ valgusDeg: 0, trunkLeanDeg: 0, hopDistanceCm: 120 });
    expect(validateSessionPayload({ trials: [normalized] }).ok).toBe(true);
  });

  it('still rejects an impossible hop distance', () => {
    const result = validateSessionPayload({
      trials: [
        { test: 'single-hop', leg: 'healthy', trialNo: 1, valid: true, voidReasons: [], metrics: { hopDistanceCm: 900 } },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/hopDistanceCm must be between 0 and 400/);
  });
});
