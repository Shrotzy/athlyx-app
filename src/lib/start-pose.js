/**
 * Start trigger from a body position — no gesture classifier, no extra model.
 *
 * The chosen position is BOTH HANDS ON TOP OF THE HEAD, not arms raised:
 *
 *  - an arm raised straight up leaves the top of the frame for a tall athlete
 *    with long arms, and once the wrist is out of frame its visibility drops and
 *    the trigger can never fire;
 *  - the head sits in the middle of the frame, so hands on the head stay well
 *    inside it whatever the athlete's height;
 *  - two hands on the head is a deliberate, unmistakable pose, so scratching an
 *    ear or adjusting a shirt cannot start a trial by accident.
 *
 * Everything here is a comparison of landmarks the pose model already produces.
 * Coordinates are normalised 0..1 with y growing downwards, as MediaPipe emits,
 * so a smaller y is higher up. Kept free of MediaPipe imports so it is unit
 * testable in Node.
 */

/** How far above or below the head, in frame heights, a wrist may sit. */
const VERTICAL_TOLERANCE = 0.1;

/** How far to the side of the head, in frame widths, a wrist may sit. */
const HORIZONTAL_TOLERANCE = 0.3;

function midpoint(a, b) {
  if (!a?.visible || !b?.visible) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Head reference: the nose when it is visible, otherwise just above the shoulders. */
function headReference(points) {
  const nose = points?.nose;
  if (nose?.visible) return { x: nose.x, y: nose.y };

  const shoulders = midpoint(points?.leftShoulder, points?.rightShoulder);
  if (shoulders) return { x: shoulders.x, y: shoulders.y - 0.2 };

  return null;
}

/**
 * @returns {{both: boolean, left: boolean, right: boolean}}
 *   `both` is the start signal; the sides are reported so the screen can say
 *   which hand still needs to come up.
 */
export function handsOnHead(points) {
  if (!points) return { both: false, left: false, right: false };

  const head = headReference(points);
  if (!head) return { both: false, left: false, right: false };

  const resting = (side) => {
    const wrist = points?.[`${side}Wrist`];
    if (!wrist?.visible) return false;
    return Math.abs(wrist.y - head.y) <= VERTICAL_TOLERANCE && Math.abs(wrist.x - head.x) <= HORIZONTAL_TOLERANCE;
  };

  const left = resting('left');
  const right = resting('right');
  return { both: left && right, left, right };
}
