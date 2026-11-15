/**
 * Browser pose tracking. Video frames never leave the device: the landmarker
 * runs locally in the page and only derived numbers and landmark sequences are
 * ever sent to the server.
 */

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

import { MEDIAPIPE_INDEX } from '@shared/landmarks.js';

const WASM_URL =
  import.meta.env.VITE_POSE_WASM_URL ||
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';

const MODEL_URL =
  import.meta.env.VITE_POSE_MODEL_URL ||
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

export async function createPoseLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/** Request the rear camera when available, at the highest practical frame rate. */
export async function startCamera(video, { facingMode = 'environment', frameRate = 60 } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not expose a camera. Try Chrome, Edge or Safari over HTTPS.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: frameRate, min: 24 },
    },
  });

  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

/** Reshape MediaPipe's landmark array into the named points the math uses. */
export function namedPoints(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) return null;
  const points = {};
  for (const [name, index] of Object.entries(MEDIAPIPE_INDEX)) {
    const point = landmarks[index];
    if (!point) continue;
    points[name] = {
      x: point.x,
      y: point.y,
      v: point.visibility ?? 1,
      visible: (point.visibility ?? 1) >= 0.35,
    };
  }
  return points;
}

/** Rolling frame-rate estimate. */
export function createFpsMeter(windowSize = 30) {
  const times = [];
  const meter = {
    lastFps: 0,
    push(timeMs) {
      times.push(timeMs);
      if (times.length > windowSize) times.shift();
      if (times.length < 2) return 0;
      const elapsed = times[times.length - 1] - times[0];
      const fps = elapsed > 0 ? ((times.length - 1) * 1000) / elapsed : 0;
      meter.lastFps = fps;
      return fps;
    },
    reset() {
      times.length = 0;
      meter.lastFps = 0;
    },
  };
  return meter;
}
