/**
 * Turns "the athlete is holding the start position" into a single start signal.
 *
 * The pose loop reports the position many times a second. Without this, one
 * raised hand would start five trials in a row. The gate fires once, only after
 * the position has been held for `holdMs`, and will not fire again until the
 * athlete lowers the hand or moves out of the position.
 *
 * Kept free of imports so it can be unit tested in Node.
 */

export function createHoldGate({ holdMs = 600, cooldownMs = 1200 } = {}) {
  let activeSince = null;
  let firedAt = -Infinity;
  let waitingForRelease = false;

  return {
    reset() {
      activeSince = null;
      firedAt = -Infinity;
      waitingForRelease = false;
    },

    /**
     * @returns {{fired: boolean, progress: number, active: boolean}}
     *   `progress` runs 0..1 over the hold so the screen can say "keep holding".
     */
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
