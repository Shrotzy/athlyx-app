/**
 * Which way is the athlete facing the camera?
 *
 * The hop tests must be filmed from the side, because the hop distance is read
 * along the image's x axis. The single-leg landing test must be filmed from the
 * front, because knee valgus is a sideways movement.
 *
 * A projected shoulder width relative to torso height is a reliable tell:
 * facing the camera the shoulders span roughly a third of the torso, and from
 * the side they collapse to a narrow band.
 */

const FRONT_RATIO = 0.18;

export function estimateView(points) {
  const left = points?.leftShoulder;
  const right = points?.rightShoulder;
  if (!left?.visible || !right?.visible) return null;

  const width = Math.abs(left.x - right.x);
  const shoulderMidY = (left.y + right.y) / 2;

  const nose = points?.nose;
  const top = nose?.visible ? nose.y : shoulderMidY;

  const leftAnkle = points?.leftAnkle;
  const rightAnkle = points?.rightAnkle;
  const ankle = leftAnkle?.visible ? leftAnkle : rightAnkle?.visible ? rightAnkle : null;
  const hipLeft = points?.leftHip;
  const hipRight = points?.rightHip;
  const bottom = ankle
    ? ankle.y
    : hipLeft?.visible && hipRight?.visible
      ? (hipLeft.y + hipRight.y) / 2
      : null;

  if (!Number.isFinite(bottom) || !Number.isFinite(top)) return null;

  const height = Math.abs(bottom - top);
  if (height < 0.15) return null;

  return width / height >= FRONT_RATIO ? 'front' : 'side';
}

/** The view a test has to be filmed from, for the runner's guidance. */
export function expectedView(test) {
  return test === 'single-leg-landing' ? 'front' : 'side';
}
