/**
 * Protocol constants for ATHLYx.
 *
 * Every tunable value in section 2 of the requirements lives here so the
 * scoring engine, the UI copy and the tests all read the same numbers.
 * These are documented placeholders and still need clinician sign-off.
 */

export const TESTS = {
  SINGLE_HOP: 'single-hop',
  CROSSOVER_HOP: 'crossover-hop',
  SINGLE_LEG_LANDING: 'single-leg-landing',
};

export const HOP_TESTS = [TESTS.SINGLE_HOP, TESTS.CROSSOVER_HOP];

export const TEST_LIST = [TESTS.SINGLE_HOP, TESTS.CROSSOVER_HOP, TESTS.SINGLE_LEG_LANDING];

export const TEST_META = {
  [TESTS.SINGLE_HOP]: {
    label: 'Single hop for distance',
    shortLabel: 'Single hop',
    cameraView: 'side',
    scoredBy: 'distance',
    summary: 'Hop forward as far as possible on one leg and hold the landing.',
    measures: 'Hop distance (scored). Landing knee flexion and forward trunk lean (supporting).',
    athleteBrief:
      'Hop forward as far as you can on one leg, land on the same leg and hold still until the trial is saved.',
    trialsPerLeg: 4, // 1 practice + 3 scored
  },
  [TESTS.CROSSOVER_HOP]: {
    label: 'Crossover hop (2 continuous hops)',
    shortLabel: 'Crossover hop',
    cameraView: 'side',
    scoredBy: 'distance',
    summary: 'Take two continuous hops on one leg, crossing the centre line each time, and hold the final landing.',
    measures: 'Total hop distance over two hops (scored). Landing knee flexion (supporting).',
    athleteBrief:
      'Take two hops forward on the same leg, crossing the taped centre line on each hop, then hold the final landing.',
    trialsPerLeg: 4,
  },
  [TESTS.SINGLE_LEG_LANDING]: {
    label: 'Single-leg landing',
    shortLabel: 'Single-leg landing',
    cameraView: 'front',
    scoredBy: 'landing-quality',
    summary: 'Step down from a low step onto one leg and hold the landing.',
    measures: 'Dynamic knee valgus and lateral trunk lean (scored).',
    athleteBrief:
      'Step off the low step onto one leg and hold the landing still until the trial is saved.',
    trialsPerLeg: 4,
  },
};

export const LEGS = {
  OPERATED: 'operated',
  HEALTHY: 'healthy',
};

export const LEG_LIST = [LEGS.OPERATED, LEGS.HEALTHY];

export const SIDES = {
  LEFT: 'left',
  RIGHT: 'right',
};

export const STATUS = {
  MEETS: 'meets',
  BORDERLINE: 'borderline',
  BELOW: 'below',
  INSUFFICIENT: 'insufficient',
};

export const STATUS_LABEL = {
  [STATUS.MEETS]: 'Meets target criteria',
  [STATUS.BORDERLINE]: 'Borderline',
  [STATUS.BELOW]: 'Below target criteria',
  [STATUS.INSUFFICIENT]: 'Insufficient data',
};

/**
 * Placeholder parameters — section 2, "Parameters". Change them in one place.
 */
export const PARAMS = {
  targetScore: 90, // target score per test (%)
  borderlineLow: 85, // bottom of the borderline band (%)
  borderlineHigh: 90, // top of the borderline band (%)
  markerFloor: 85, // landing marker floor (%)
  valgusWeight: 0.7,
  trunkWeight: 0.3,
  lowerIsBetterBuffer: 5, // degrees, avoids division by zero
  practiceTrials: 1,
  scoredTrials: 3,
  minValidTrials: 3,
  maxAttempts: 6,
  crossoverHops: 2,
  minFrameRate: 30, // below this we warn / mark the trial unreliable
  preferredFrameRate: 60,
  holdSeconds: 1.5, // landing must be held this long
  trendLabel: 'Average of the three test scores',
};

export const DECISIONS = {
  CONFIRM: 'confirm',
  DEFER: 'defer',
  RETEST: 'retest',
};

export const DECISION_LABEL = {
  [DECISIONS.CONFIRM]: 'Confirm results',
  [DECISIONS.DEFER]: 'Defer',
  [DECISIONS.RETEST]: 'Re-test',
};

export const ROLES = {
  ATHLETE: 'athlete',
  THERAPIST: 'therapist',
};

export const SAFETY_NOTICE =
  'ATHLYx is a movement-monitoring and decision-support aid for you and your care team. It does not diagnose anything and it is not a return-to-sport clearance. Do not do these tests unless your physical therapist has cleared you for high-impact work, warm up first, use a clear non-slip surface, and stop if you feel pain.';

export const PLAN_SAFETY_NOTICE =
  'Stop if you feel pain and contact your therapist. Progress only as your therapist has described.';

export const DISCLAIMER_SHORT =
  'Monitoring aid only — not a diagnosis and not a return-to-sport clearance.';
