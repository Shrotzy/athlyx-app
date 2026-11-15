/**
 * Hand-gesture recognition, used only for hands-free trial start.
 *
 * MediaPipe's gesture recognizer ships with a small set of canned classes,
 * including the two this app uses: Thumb_Up and Open_Palm. It is a separate
 * model from the pose model, so it is loaded lazily and only when hands-free
 * start is switched on: nobody pays for the download if they only want a
 * button.
 *
 * Only the gesture label leaves this module. No image is stored or sent.
 */

import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';

import { POSE_WASM_URL } from './pose.js';

export const GESTURE_MODEL_URL =
  import.meta.env.VITE_GESTURE_MODEL_URL ||
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

export async function createGestureRecognizer({ delegate = 'GPU' } = {}) {
  const vision = await FilesetResolver.forVisionTasks(POSE_WASM_URL);

  const build = (delegateName) =>
    GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate: delegateName },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  try {
    return await build(delegate);
  } catch (error) {
    if (delegate === 'GPU') {
      console.warn('[gesture] GPU delegate unavailable, retrying on CPU:', error?.message || error);
      return build('CPU');
    }
    throw error;
  }
}

/** Highest-confidence recognised gesture, or null when no hand is showing one. */
export function bestGesture(result) {
  let best = null;
  for (const categories of result?.gestures || []) {
    for (const category of categories || []) {
      const name = category?.categoryName;
      const score = Number(category?.score ?? 0);
      if (!name || name === 'None' || !Number.isFinite(score)) continue;
      if (!best || score > best.score) best = { name, score };
    }
  }
  return best;
}

export function closeGestureRecognizer(recognizer) {
  try {
    recognizer?.close?.();
  } catch {
    /* already closed */
  }
}
