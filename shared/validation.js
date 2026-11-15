/**
 * Trial validity vocabulary.
 *
 * From the requirements: voided trials are never scored. Landing-not-held and
 * tracking-lost are detected reliably in the browser; other-foot-touchdown and
 * pausing-between-hops are detected on a best-effort basis and the therapist can
 * check them in the replay.
 */

export const VOID_REASONS = {
  'other-foot-touchdown': 'Other foot touched down',
  'paused-between-hops': 'Paused between hops',
  'landing-not-held': 'Landing was not held',
  'tracking-lost': 'Tracking was lost',
  'low-frame-rate': 'Frame rate too low for reliable landing detection',
  'no-takeoff-detected': 'No take-off was detected',
  'no-landing-detected': 'No landing was detected',
};

/** Reasons the app itself can detect reliably. */
export const AUTOMATIC_VOID_REASONS = ['landing-not-held', 'tracking-lost', 'low-frame-rate'];

/** Best-effort reasons — surfaced for the therapist to verify in the replay. */
export const BEST_EFFORT_VOID_REASONS = ['other-foot-touchdown', 'paused-between-hops'];

export const CAMERA_SETUPS = {
  SIDE: 'side',
  FRONT: 'front',
};

export function isKnownVoidReason(reason) {
  return Object.prototype.hasOwnProperty.call(VOID_REASONS, reason);
}

export function normalizeVoidReasons(reasons) {
  if (!Array.isArray(reasons)) return [];
  return [...new Set(reasons.filter(isKnownVoidReason))];
}

export function describeVoidReasons(reasons) {
  return normalizeVoidReasons(reasons)
    .map((reason) => VOID_REASONS[reason])
    .join('; ');
}

/**
 * A trial is valid only when no void reason survived. Validity is always
 * derived, never trusted from the client flag alone.
 */
export function isValidTrial(trial) {
  if (!trial) return false;
  const reasons = normalizeVoidReasons(trial.voidReasons);
  return reasons.length === 0 && trial.valid !== false;
}

const FINITE = (value) => typeof value === 'number' && Number.isFinite(value);

const METRIC_RULES = {
  'single-hop': { required: ['hopDistanceCm'], optional: ['kneeFlexionDeg', 'forwardTrunkLeanDeg'] },
  'crossover-hop': { required: ['hopDistanceCm'], optional: ['kneeFlexionDeg', 'forwardTrunkLeanDeg'] },
  'single-leg-landing': { required: ['valgusDeg', 'trunkLeanDeg'], optional: [] },
};

/**
 * Validate a submitted session payload. Returns { ok, errors }.
 * The API recomputes every score from these numbers, so bad input is rejected
 * rather than clamped silently.
 */
export function validateSessionPayload({ trials } = {}) {
  const errors = [];

  if (!Array.isArray(trials) || trials.length === 0) {
    return { ok: false, errors: ['No trials were submitted.'] };
  }

  trials.forEach((trial, index) => {
    const where = `trial ${index + 1}`;
    if (!METRIC_RULES[trial?.test]) {
      errors.push(`${where}: unknown test "${trial?.test}".`);
      return;
    }
    if (trial.leg !== 'operated' && trial.leg !== 'healthy') {
      errors.push(`${where}: leg must be "operated" or "healthy".`);
    }
    if (!Number.isInteger(trial.trialNo) || trial.trialNo < 1) {
      errors.push(`${where}: trialNo must be a positive integer.`);
    }
    const rules = METRIC_RULES[trial.test];
    const metrics = trial.metrics || {};
    if (isValidTrial(trial)) {
      rules.required.forEach((key) => {
        if (!FINITE(metrics[key])) errors.push(`${where}: valid trial is missing a finite ${key}.`);
        if (FINITE(metrics[key]) && (metrics[key] < 0 || metrics[key] > 1000)) {
          errors.push(`${where}: ${key} is out of plausible range.`);
        }
      });
    }
    rules.optional.forEach((key) => {
      if (metrics[key] != null && !FINITE(metrics[key])) {
        errors.push(`${where}: ${key} must be a number when present.`);
      }
    });
    if (trial.landmarks != null && !Array.isArray(trial.landmarks?.frames)) {
      errors.push(`${where}: landmarks must contain a frames array.`);
    }
  });

  return { ok: errors.length === 0, errors };
}

/** Simple, readable validation for the auth/profile endpoints. */
export function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (password.length > 200) return 'Password is too long.';
  return null;
}
