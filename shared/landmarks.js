/**
 * Stored landmark format.
 *
 * Only 12 named points per frame are kept, rounded to 4 decimals, so a trial
 * replays as a skeleton without ever storing video or images.
 */

export const LANDMARK_POINTS = [
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
  'leftHeel',
  'rightHeel',
  'leftToe',
  'rightToe',
];

/** MediaPipe Pose Landmarker indices for the points we keep. */
export const MEDIAPIPE_INDEX = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftToe: 31,
  rightToe: 32,
};

/** Edges drawn by the live overlay and the replay canvas. */
export const SKELETON_EDGES = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
  ['leftAnkle', 'leftHeel'],
  ['leftHeel', 'leftToe'],
  ['rightAnkle', 'rightHeel'],
  ['rightHeel', 'rightToe'],
];

export const MIN_VISIBILITY = 0.4;

/** Flatten a pose landmark array into [x, y, visibility, ...] for one frame. */
export function encodeFrame(landmarks, { minVisibility = MIN_VISIBILITY } = {}) {
  const frame = [];
  for (const name of LANDMARK_POINTS) {
    const index = MEDIAPIPE_INDEX[name];
    const point = landmarks?.[index];
    const visible = point && (point.visibility == null || point.visibility >= minVisibility);
    frame.push(visible ? point.x : -1, visible ? point.y : -1, visible ? point.visibility ?? 1 : 0);
  }
  return frame;
}

/** Turn one stored frame back into named points. */
export function decodeFrame(frame) {
  const points = {};
  LANDMARK_POINTS.forEach((name, index) => {
    const x = frame[index * 3];
    const y = frame[index * 3 + 1];
    const v = frame[index * 3 + 2];
    points[name] = { x, y, v, visible: x >= 0 && y >= 0 && v > 0 };
  });
  return points;
}

export function roundFrame(frame) {
  return frame.map((value) => Math.round(Number(value) * 10000) / 10000);
}

/**
 * Compact stored form. Frames are capped so a long trial cannot blow up the
 * payload; the replay only needs a short window anyway.
 */
export function compactLandmarks(landmarks, { maxFrames = 360 } = {}) {
  const frames = landmarks?.frames;
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const step = Math.max(1, Math.ceil(frames.length / maxFrames));
  const kept = [];
  for (let index = 0; index < frames.length; index += step) {
    kept.push(roundFrame(frames[index]));
  }
  return { points: LANDMARK_POINTS, fps: Math.round(landmarks.fps || 30), frames: kept };
}

export function decodeLandmarks(stored) {
  if (!stored || !Array.isArray(stored.frames)) return null;
  return {
    fps: stored.fps || 30,
    frames: stored.frames.map((frame) => decodeFrame(frame)),
    points: stored.points || LANDMARK_POINTS,
  };
}
