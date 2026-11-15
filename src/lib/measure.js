/**
 * Measurement maths for 2D camera pose data.
 *
 * Everything here is a documented approximation of the protocol in section 2
 * and the measurement rules in section 4 of the requirements. Values are
 * reported with one decimal and are always compared leg-to-leg on the same
 * camera setup, which cancels a fixed scale error.
 *
 * Coordinates are normalised 0..1 with y growing downwards, as MediaPipe emits.
 */

import { PARAMS } from '@shared/constants.js';

export const rad2deg = (radians) => (radians * 180) / Math.PI;

export function midpoint(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Interior angle ABC in degrees. */
export function angleAt(a, b, c) {
  if (!a || !b || !c) return null;
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const magnitudes = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (magnitudes < 1e-9) return null;
  const cosine = Math.min(1, Math.max(-1, (abx * cbx + aby * cby) / magnitudes));
  return rad2deg(Math.acos(cosine));
}

/** Knee flexion: 0 degrees is a straight leg. */
export function kneeFlexionDeg(hip, knee, ankle) {
  const interior = angleAt(hip, knee, ankle);
  return interior == null ? null : Math.max(0, 180 - interior);
}

/**
 * Forward trunk lean in the side view, measured from vertical.
 * Positive means the chest is ahead of the hips in the direction of travel.
 */
export function forwardTrunkLeanDeg(shoulderMid, hipMid, facing = 'right') {
  if (!shoulderMid || !hipMid) return null;
  const sign = facing === 'left' ? -1 : 1;
  const dx = (shoulderMid.x - hipMid.x) * sign;
  const dy = Math.abs(hipMid.y - shoulderMid.y);
  if (dy < 1e-9) return null;
  return rad2deg(Math.atan2(dx, dy));
}

/** Lateral trunk lean in the front view, measured from vertical (unsigned). */
export function lateralTrunkLeanDeg(shoulderMid, hipMid) {
  if (!shoulderMid || !hipMid) return null;
  const dx = Math.abs(shoulderMid.x - hipMid.x);
  const dy = Math.abs(hipMid.y - shoulderMid.y);
  if (dy < 1e-9) return null;
  return rad2deg(Math.atan2(dx, dy));
}

/**
 * Signed frontal-plane knee valgus in degrees.
 *
 * We compare the actual knee position with the hip-to-ankle line and convert
 * the sideways offset into an angle. Positive = knee toward the midline
 * (inward collapse, the pattern this test is looking for).
 */
export function frontalValgusDeg(hip, knee, ankle, midlineX) {
  if (!hip || !knee || !ankle) return null;
  const dy = ankle.y - hip.y;
  if (Math.abs(dy) < 1e-6) return null;
  const expectedKneeX = hip.x + ((knee.y - hip.y) / dy) * (ankle.x - hip.x);
  const offset = knee.x - expectedKneeX;
  const towardMidline = Math.sign(midlineX - expectedKneeX) || 1;
  const signedOffset = offset * towardMidline;
  const shinLength = Math.hypot(ankle.x - knee.x, ankle.y - knee.y);
  if (shinLength < 1e-6) return null;
  return rad2deg(Math.atan2(signedOffset, Math.max(shinLength, 1e-6)));
}

/** Anthropometric approximation used only to display centimetres. */
export function legLengthCmFromHeight(heightCm) {
  if (!Number.isFinite(heightCm)) return null;
  return heightCm * 0.53;
}

/**
 * Convert a horizontal image displacement into centimetres, using the
 * standing hip-to-ankle length as the pixel ruler for that session.
 *
 * The LSI only uses a ratio between legs, so a fixed scale error cancels out.
 */
export function hopDistanceCm({ takeoffX, landingX, aspect, standingDy, heightCm }) {
  const values = [takeoffX, landingX, aspect, standingDy, heightCm];
  if (!values.every((value) => Number.isFinite(value))) return null;
  if (standingDy <= 0.01 || aspect <= 0) return null;
  const legLengthCm = legLengthCmFromHeight(heightCm);
  if (!legLengthCm) return null;
  const cmPerFrameHeight = legLengthCm / standingDy;
  const horizontal = Math.abs(landingX - takeoffX) * aspect;
  const distance = horizontal * cmPerFrameHeight;
  if (!Number.isFinite(distance) || distance <= 0 || distance > 400) return null;
  return Math.round(distance * 10) / 10;
}

export function medianOf(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pointFor(points, name, minVisibility = 0.35) {
  const point = points?.[name];
  if (!point) return null;
  if (point.visible === false) return null;
  if (Number.isFinite(point.v) && point.v < minVisibility) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (point.x < 0 || point.y < 0) return null;
  return point;
}

export function legPoints(points, side) {
  const prefix = side === 'left' ? 'left' : 'right';
  const other = side === 'left' ? 'right' : 'left';
  return {
    hip: pointFor(points, `${prefix}Hip`) || pointFor(points, `${other}Hip`),
    knee: pointFor(points, `${prefix}Knee`) || pointFor(points, `${other}Knee`),
    ankle: pointFor(points, `${prefix}Ankle`) || pointFor(points, `${other}Ankle`),
    heel: pointFor(points, `${prefix}Heel`) || pointFor(points, `${other}Heel`),
    toe: pointFor(points, `${prefix}Toe`) || pointFor(points, `${other}Toe`),
    shoulder: pointFor(points, `${prefix}Shoulder`) || pointFor(points, `${other}Shoulder`),
  };
}

export function otherLegPoints(points, side) {
  return legPoints(points, side === 'left' ? 'right' : 'left');
}

/**
 * Hop / crossover-hop detector (side view).
 *
 * States: calibrating -> grounded -> airborne -> grounded -> held -> done.
 * The landing must be held for PARAMS.holdSeconds to count.
 */
export class HopTrialDetector {
  constructor({ side = 'right', hops = 1, fps = 60, maxDurationMs = 12_000 } = {}) {
    this.side = side;
    this.hopsRemaining = hops;
    this.fps = fps;
    this.maxDurationMs = maxDurationMs;

    this.state = 'calibrating';
    this.baselineSamples = [];
    this.baselineY = null;
    this.standingDy = null;
    this.startedAt = null;

    this.takeoffX = null;
    this.takeoffY = null;
    this.landingX = null;
    this.takeoffCount = 0;
    this.landingCount = 0;

    this.holdStartedAt = null;
    this.holdMs = 0;
    this.frames = 0;
    this.lostFrames = 0;

    this.result = null;
    this.landingKneeFlexionDeg = null;
    this.landingTrunkLeanDeg = null;
    this.peakKneeFlexionDeg = null;
  }

  push(points, timeMs) {
    this.frames += 1;

    const leg = legPoints(points, this.side);
    if (!leg.ankle || !leg.toe || !leg.heel) {
      this.lostFrames += 1;
      if (this.state === 'calibrating' && this.baselineSamples.length < 10) {
        return { phase: 'searching', done: false, hint: 'Step back so your whole body, feet included, is in frame.' };
      }
      return { phase: this.state, done: false, hint: 'Tracking lost — step back into frame.', tracking: false };
    }

    if (this.state === 'calibrating') {
      this.baselineSamples.push(leg.ankle.y);
      if (this.baselineSamples.length >= 20) {
        this.baselineY = medianOf(this.baselineSamples);
        if (leg.hip) this.standingDy = Math.abs(leg.ankle.y - leg.hip.y);
        this.state = 'grounded';
        this.startedAt = timeMs;
      }
      return { phase: 'calibrating', done: false, hint: 'Stand still on both feet for a moment.' };
    }

    if (!this.startedAt) this.startedAt = timeMs;
    if (timeMs - this.startedAt > this.maxDurationMs) {
      this.result = this.finish(false, 'no-landing-detected');
      return { phase: 'done', done: true, result: this.result };
    }

    const lift = this.baselineY - leg.ankle.y; // positive when the foot is off the floor
    const grounded = lift < 0.035;

    if (this.state === 'grounded') {
      if (lift > 0.055) {
        // Freeze the take-off reference on the first hop so a crossover hop
        // measures first take-off to final landing, as the protocol says.
        if (this.takeoffCount === 0) {
          this.takeoffX = leg.toe.x;
          this.takeoffY = leg.toe.y;
        }
        this.state = 'airborne';
        this.takeoffCount += 1;
      } else if (this.takeoffCount === 0) {
        this.takeoffX = leg.toe.x;
        this.takeoffY = leg.toe.y;
      }
      return { phase: 'grounded', done: false, hint: 'Hop when you are ready.', lift: 0 };
    }

    if (this.state === 'airborne') {
      this.peakKneeFlexionDeg = leg.knee
        ? Math.max(this.peakKneeFlexionDeg ?? 0, kneeFlexionDeg(leg.hip, leg.knee, leg.ankle) ?? 0)
        : this.peakKneeFlexionDeg;
      if (grounded) {
        this.state = 'grounded';
        this.landingCount += 1;
        this.landingX = leg.heel.x;
        if (leg.knee && leg.hip) {
          this.landingKneeFlexionDeg = kneeFlexionDeg(leg.hip, leg.knee, leg.ankle);
        }
        const shoulderMid = midpoint(pointFor(points, 'leftShoulder'), pointFor(points, 'rightShoulder'));
        const hipMid = midpoint(pointFor(points, 'leftHip'), pointFor(points, 'rightHip'));
        this.landingTrunkLeanDeg = forwardTrunkLeanDeg(shoulderMid, hipMid, 'right');
        this.hopsRemaining -= 1;
        this.holdStartedAt = null;
        this.holdMs = 0;
        if (this.hopsRemaining <= 0) this.state = 'landed';
      }
      return { phase: 'airborne', done: false, hint: 'In the air.' };
    }

    if (this.state === 'landed') {
      if (!grounded) {
        // Bounced off the landing: not held.
        this.state = 'airborne';
        return { phase: 'airborne', done: false, hint: 'Hold the landing — stay still.' };
      }
      if (leg.knee && leg.hip) {
        const flexion = kneeFlexionDeg(leg.hip, leg.knee, leg.ankle);
        if (Number.isFinite(flexion)) {
          this.landingKneeFlexionDeg = Math.max(this.landingKneeFlexionDeg ?? 0, flexion);
        }
      }
      if (this.holdStartedAt == null) this.holdStartedAt = timeMs;
      this.holdMs = timeMs - this.holdStartedAt;
      if (this.holdMs >= PARAMS.holdSeconds * 1000) {
        this.result = this.finish(true);
        this.state = 'done';
        return { phase: 'done', done: true, result: this.result };
      }
      return {
        phase: 'landed',
        done: false,
        hint: `Hold your landing… ${(PARAMS.holdSeconds - this.holdMs / 1000).toFixed(1)}s`,
        holdMs: this.holdMs,
      };
    }

    return { phase: this.state, done: false, hint: '' };
  }

  finish(ok, reason = null) {
    const lostRatio = this.frames > 0 ? this.lostFrames / this.frames : 0;
    const takeoffX = this.takeoffX;
    const landingX = this.landingX;
    return {
      ok,
      reason,
      voidReasons: ok ? [] : [reason || 'no-landing-detected'],
      takeoffX,
      landingX,
      aspect: null,
      standingHipAnkleDy: this.standingDy,
      landingKneeFlexionDeg: this.landingKneeFlexionDeg,
      landingTrunkLeanDeg: this.landingTrunkLeanDeg,
      peakKneeFlexionDeg: this.peakKneeFlexionDeg,
      lostRatio,
      holdSeconds: this.holdMs / 1000,
      hops: this.takeoffCount,
    };
  }
}

/**
 * Single-leg landing detector (front view).
 *
 * Baseline is standing on the step; the landing begins when the hips drop.
 * Peak valgus and peak lateral trunk lean are tracked until the landing is held.
 */
export class LandingTrialDetector {
  constructor({ side = 'right', fps = 60, holdSeconds = PARAMS.holdSeconds, maxDurationMs = 12_000 } = {}) {
    this.side = side;
    this.fps = fps;
    this.holdSeconds = holdSeconds;
    this.maxDurationMs = maxDurationMs;

    this.state = 'calibrating';
    this.baseline = [];
    this.baselineY = null;
    this.startedAt = null;

    this.peakValgus = null;
    this.peakTrunkLean = null;
    this.frames = 0;
    this.lostFrames = 0;
    this.holdStartedAt = null;
    this.holdMs = 0;
    this.result = null;
    this.landingDetected = false;
    this.recentHipY = [];
  }

  push(points, timeMs) {
    this.frames += 1;

    const leg = legPoints(points, this.side);
    const hipMid = midpoint(pointFor(points, 'leftHip'), pointFor(points, 'rightHip'));
    const shoulderMid = midpoint(pointFor(points, 'leftShoulder'), pointFor(points, 'rightShoulder'));

    if (!leg.hip || !leg.knee || !leg.ankle || !hipMid) {
      this.lostFrames += 1;
      return { phase: this.state, done: false, hint: 'Tracking lost — step back into frame.', tracking: false };
    }

    if (this.state === 'calibrating') {
      this.baseline.push(hipMid.y);
      if (this.baseline.length >= 20) {
        this.baselineY = medianOf(this.baseline);
        this.state = 'ready';
        this.startedAt = timeMs;
      }
      return { phase: 'calibrating', done: false, hint: 'Stand tall on the step, facing the camera.' };
    }

    if (!this.startedAt) this.startedAt = timeMs;
    if (timeMs - this.startedAt > this.maxDurationMs) {
      this.result = this.finish(false, this.landingDetected ? 'landing-not-held' : 'no-landing-detected');
      return { phase: 'done', done: true, result: this.result };
    }

    const drop = hipMid.y - this.baselineY; // positive after stepping down

    if (this.state === 'ready') {
      if (drop > 0.05) {
        this.state = 'landing';
        this.landingDetected = true;
        this.holdStartedAt = null;
      }
      return { phase: 'ready', done: false, hint: 'Step off the step when you are ready.' };
    }

    const valgus = frontalValgusDeg(leg.hip, leg.knee, leg.ankle, hipMid.x);
    if (Number.isFinite(valgus)) {
      this.peakValgus = this.peakValgus == null ? valgus : Math.max(this.peakValgus, valgus);
    }
    const trunkLean = lateralTrunkLeanDeg(shoulderMid, hipMid);
    if (Number.isFinite(trunkLean)) {
      this.peakTrunkLean = this.peakTrunkLean == null ? trunkLean : Math.max(this.peakTrunkLean, trunkLean);
    }

    // Held when the hips stop moving. A short rolling window keeps camera
    // jitter from being mistaken for movement (or for stillness).
    this.recentHipY.push(hipMid.y);
    if (this.recentHipY.length > 8) this.recentHipY.shift();
    const spread = Math.max(...this.recentHipY) - Math.min(...this.recentHipY);
    if (this.recentHipY.length < 8 || spread > 0.012) {
      this.holdStartedAt = null;
      this.holdMs = 0;
      return { phase: 'landing', done: false, hint: 'Absorb the landing and hold still.' };
    }
    if (this.holdStartedAt == null) {
      this.holdStartedAt = timeMs;
    }
    this.holdMs = timeMs - this.holdStartedAt;

    if (this.holdMs >= this.holdSeconds * 1000) {
      this.result = this.finish(true);
      this.state = 'done';
      return { phase: 'done', done: true, result: this.result };
    }

    return {
      phase: 'landing',
      done: false,
      hint: `Hold your landing… ${(this.holdSeconds - this.holdMs / 1000).toFixed(1)}s`,
      holdMs: this.holdMs,
      valgus: this.peakValgus,
    };
  }

  finish(ok, reason = null) {
    const lostRatio = this.frames > 0 ? this.lostFrames / this.frames : 0;
    return {
      ok,
      reason,
      voidReasons: ok ? [] : [reason || 'no-landing-detected'],
      peakValgusDeg: this.peakValgus,
      peakTrunkLeanDeg: this.peakTrunkLean,
      lostRatio,
      holdSeconds: this.holdMs / 1000,
    };
  }
}
