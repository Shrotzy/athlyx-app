/**
 * The decision layer between a hand-gesture classifier and the trial.
 *
 * Deliberately free of MediaPipe imports so it can be unit tested in Node:
 * the classifier says "Thumb_Up, 0.87" many times a second, and this turns
 * that stream into a single start signal.
 *
 * A gesture fires once, only after being held for `holdMs`, and cannot fire
 * again until the hand is lowered or changed. That stops one raised thumb from
 * starting five trials in a row.
 */

/**
 * The same hold-and-release logic for a plain boolean signal, such as "a hand
 * is raised", which the pose model already gives us. Shorter hold than the
 * gesture classifier because a raised hand is unambiguous.
 */
export function createHoldGate({ holdMs = 400, cooldownMs = 1200 } = {}) {
  let activeSince = null;
  let firedAt = -Infinity;
  let waitingForRelease = false;

  return {
    reset() {
      activeSince = null;
      firedAt = -Infinity;
      waitingForRelease = false;
    },
    update(active, now) {
      if (!active) {
        activeSince = null;
        waitingForRelease = false;
        return { fired: false, progress: 0, active: false };
      }
      if (activeSince == null) activeSince = now;
      if (waitingForRelease) return { fired: false, progress: 1, active: true };

      const elapsed = now - activeSince;
      if (elapsed >= holdMs && now - firedAt >= cooldownMs) {
        firedAt = now;
        waitingForRelease = true;
        return { fired: true, progress: 1, active: true };
      }
      return { fired: false, progress: Math.min(1, elapsed / holdMs), active: true };
    },
  };
}

/** Gestures accepted as "I am ready", from MediaPipe's canned classifier. */
export const START_GESTURES = ['Thumb_Up', 'Open_Palm'];

export const GESTURE_LABEL = {
  Thumb_Up: 'thumbs up',
  Open_Palm: 'open palm',
};

export function createGestureGate({
  want = START_GESTURES,
  holdMs = 600,
  minScore = 0.6,
  cooldownMs = 1200,
} = {}) {
  let held = null;
  let heldSince = 0;
  let firedAt = -Infinity;
  let waitingForRelease = false;

  return {
    reset() {
      held = null;
      heldSince = 0;
      firedAt = -Infinity;
      waitingForRelease = false;
    },

    /**
     * @returns {{active: boolean, fired: boolean, progress: number, gesture: string|null}}
     *   `progress` runs 0..1 over the hold, so the UI can say "keep holding".
     */
    update(gesture, score, now) {
      const matches =
        Boolean(gesture) && want.includes(gesture) && Number.isFinite(Number(score)) && Number(score) >= minScore;

      if (!matches) {
        held = null;
        heldSince = 0;
        waitingForRelease = false;
        return { active: false, fired: false, progress: 0, gesture: null };
      }

      if (held !== gesture) {
        held = gesture;
        heldSince = now;
      }

      if (waitingForRelease) {
        return { active: true, fired: false, progress: 1, gesture };
      }

      const elapsed = now - heldSince;
      if (elapsed >= holdMs && now - firedAt >= cooldownMs) {
        firedAt = now;
        waitingForRelease = true;
        return { active: true, fired: true, progress: 1, gesture };
      }

      return { active: true, fired: false, progress: Math.min(1, elapsed / holdMs), gesture };
    },
  };
}
