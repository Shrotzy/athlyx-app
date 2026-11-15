/**
 * "Is a hand raised?" — kept free of MediaPipe imports so it can be unit
 * tested in Node and reused anywhere the named points exist.
 *
 * Coordinates are normalised 0..1 with y growing downwards, as MediaPipe emits,
 * so a smaller y is higher up.
 */

export function handsRaised(points) {
  if (!points) return { any: false, left: false, right: false };

  const raised = (side) => {
    const wrist = points[`${side}Wrist`];
    const shoulder = points[`${side}Shoulder`];
    if (!wrist?.visible || !shoulder?.visible) return false;
    return wrist.y < shoulder.y - 0.03;
  };

  const left = raised('left');
  const right = raised('right');
  return { any: left || right, left, right };
}
