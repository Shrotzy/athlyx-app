/**
 * Start trigger from body position — no gesture classifier, no extra model.
 *
 * The pose model already running for the measurement produces the wrists, nose
 * and shoulders, so "both hands above the head" is a comparison of numbers
 * instead of an 8 MB classifier that has to be trained on lighting, distance
 * and background.
 *
 * Both hands are required: two raised arms are a deliberate, unmistakable pose,
 * so an athlete adjusting a shirt or scratching their head cannot start a trial
 * by accident. It also gives the camera a clean, symmetric frame before the
 * movement begins.
 *
 * Coordinates are normalised 0..1 with y growing downwards, as MediaPipe emits,
 * so a smaller y is higher up. Kept free of MediaPipe imports so it is unit
 * testable in Node.
 */

/** Is this wrist clearly above the head, using the nose and a shoulder as reference? */
function wristAboveHead(points, side) {
  const wrist = points?.[`${side}Wrist`];
  if (!wrist?.visible) return false;

  const nose = points?.nose;
  const shoulder = points?.[`${side}Shoulder`];

  // Prefer the nose: it is roughly at head height, so "above the nose" really
  // means above the head. Fall back to a shoulder-relative height when the face
  // is turned away or the nose is not visible.
  const headY = nose?.visible ? nose.y : shoulder?.visible ? shoulder.y - 0.18 : null;
  if (headY == null) return false;

  return wrist.y < headY;
}

/**
 * @returns {{both: boolean, left: boolean, right: boolean}}
 *   `both` is the start signal; the sides are reported so the screen can say
 *   which hand still needs to come up.
 */
export function handsAboveHead(points) {
  if (!points) return { both: false, left: false, right: false };
  const left = wristAboveHead(points, 'left');
  const right = wristAboveHead(points, 'right');
  return { both: left && right, left, right };
}
