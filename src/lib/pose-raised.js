/**
 * Start trigger from body position — no gesture classifier, no extra model.
 *
 * The pose model already running for the measurement produces the wrists, nose
 * and shoulders, so "a hand above the head" is a comparison of two numbers
 * instead of an 8 MB classifier that has to be trained on lighting, distance
 * and background. That is why this is the recommended signal.
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
 * @returns {{any: boolean, left: boolean, right: boolean}}
 *   `any` accepts either hand, which is friendlier for a left-handed athlete or
 *   an operated shoulder that cannot lift. The spoken instruction names the
 *   right hand so there is one unambiguous thing to demonstrate.
 */
export function handAboveHead(points) {
  if (!points) return { any: false, left: false, right: false };
  const left = wristAboveHead(points, 'left');
  const right = wristAboveHead(points, 'right');
  return { any: left || right, left, right };
}
