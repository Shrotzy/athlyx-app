/**
 * Browser pose tracking. Video frames never leave the device: the landmarker
 * runs locally in the page and only derived numbers and landmark sequences are
 * ever sent to the server.
 */

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

import { MEDIAPIPE_INDEX } from '@shared/landmarks.js';

/** Injected by vite.config.js from the installed package version. */
const VERSION =
  typeof __MEDIAPIPE_VERSION__ !== 'undefined' && __MEDIAPIPE_VERSION__
    ? __MEDIAPIPE_VERSION__
    : '0.10.35';

/**
 * The WASM runtime must match the installed JS package exactly or the CDN path
 * 404s and the landmarker never starts. Override only if you serve the files
 * from your own origin.
 */
const WASM_URL =
  import.meta.env.VITE_POSE_WASM_URL || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;

/**
 * `full` is more accurate; `lite` is several times faster and is what a phone
 * or a browser without GPU acceleration needs to reach a usable frame rate.
 * VITE_POSE_MODEL_URL overrides both (for example, a vendored model).
 */
export const MODEL_URLS = {
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};

export const MODEL_URL = import.meta.env.VITE_POSE_MODEL_URL || MODEL_URLS.full;

export const POSE_WASM_URL = WASM_URL;

/** Key points that must be visible before a trial can start. */
const REQUIRED_POINTS = [
  ['shoulders', ['leftShoulder', 'rightShoulder']],
  ['hips', ['leftHip', 'rightHip']],
  ['knees', ['leftKnee', 'rightKnee']],
  ['ankles', ['leftAnkle', 'rightAnkle']],
  ['feet', ['leftToe', 'rightToe']],
];

/**
 * Create the landmarker. GPU first for frame rate, CPU as a real fallback on
 * machines or browsers where the GPU delegate is unavailable.
 */
export async function createPoseLandmarker({ delegate = 'GPU', model = 'full' } = {}) {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const modelAssetPath = import.meta.env.VITE_POSE_MODEL_URL || MODEL_URLS[model] || MODEL_URLS.full;

  const build = (delegateName) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: delegateName },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  try {
    return await build(delegate);
  } catch (error) {
    if (delegate === 'GPU') {
      console.warn('[pose] GPU delegate unavailable, retrying on CPU:', error?.message || error);
      return build('CPU');
    }
    throw error;
  }
}

export function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** Why a camera may be unavailable, checked before asking for permission. */
export function cameraSupport() {
  if (typeof navigator === 'undefined') return { ok: false, reason: 'unsupported' };
  if (!window.isSecureContext) {
    return {
      ok: false,
      reason: 'insecure-context',
      message:
        'Camera access needs HTTPS (or localhost). Open the app over https:// — a plain http:// address will never be allowed to use the camera.',
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      reason: 'unsupported',
      message:
        'This browser does not expose a camera API. Use a recent Chrome, Edge, Firefox or Safari, and make sure you are not in a restricted private window.',
    };
  }
  return { ok: true };
}

const CAMERA_CONSTRAINTS = [
  // Preferred: rear camera, 720p, high frame rate. Everything is "ideal" so a
  // camera that cannot match it still opens instead of throwing.
  (facingMode, frameRate) => ({
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: frameRate },
    },
  }),
  // Fallback: any camera, moderate frame rate.
  () => ({ audio: false, video: { frameRate: { ideal: 30 } } }),
  // Last resort: whatever the device will give us.
  () => ({ audio: false, video: true }),
];

/** Request a camera and attach it to a <video>, with graceful constraint fallbacks. */
export async function startCamera(video, { facingMode = 'environment', frameRate = 60 } = {}) {
  const support = cameraSupport();
  if (!support.ok) {
    const error = new Error(support.message);
    error.name = support.reason;
    throw error;
  }

  let stream = null;
  let lastError = null;
  for (const build of CAMERA_CONSTRAINTS) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(build(facingMode, frameRate));
      break;
    } catch (error) {
      lastError = error;
      // A denied permission or missing device will not be fixed by loosening
      // constraints, so stop early instead of retrying three times.
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError' || error?.name === 'NotFoundError') {
        throw error;
      }
    }
  }

  if (!stream) throw lastError || new Error('No camera could be opened.');

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;

  // Safari needs the element to have dimensions before play() resolves.
  if (video.readyState < 1) {
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        video.removeEventListener('loadedmetadata', done);
        resolve();
      };
      video.addEventListener('loadedmetadata', done);
      setTimeout(done, 4000);
    });
  }

  try {
    await video.play();
  } catch (error) {
    // Autoplay refusal is not fatal if the stream is live; it usually means the
    // browser wants a user gesture, which the calling button already provides.
    console.warn('[camera] play() was rejected:', error?.message || error);
  }

  const track = stream.getVideoTracks?.()[0];
  if (track) {
    // Keep the stream alive if the user switches tabs: a stopped track shows a
    // frozen frame and every measurement afterwards would be wrong.
    track.addEventListener('mute', () => console.warn('[camera] track muted by the browser'));
  }

  return stream;
}

/** Useful facts for the preflight panel. */
export function cameraInfo(stream, video) {
  const track = stream?.getVideoTracks?.()[0];
  const settings = track?.getSettings?.() || {};
  return {
    width: settings.width || video?.videoWidth || 0,
    height: settings.height || video?.videoHeight || 0,
    frameRate: Math.round(settings.frameRate || 0),
    label: track?.label || 'camera',
    aspect: video?.videoWidth && video?.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9,
  };
}

export function stopCamera(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

/** Turn a getUserMedia / MediaPipe failure into something a person can act on. */
export function describeCameraError(error) {
  const name = error?.name || '';
  const embeddedHint = isEmbedded()
    ? ' You are viewing the app inside an embedded preview, which often blocks the camera — open the app in its own browser tab or on your phone and try again.'
    : '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Camera permission was denied or blocked.${embeddedHint} Allow camera access for this site in your browser settings, then try again.`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Plug in or enable a webcam (or use your phone) and try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is already in use by another app or tab. Close the other camera app and try again.';
    case 'OverconstrainedError':
      return 'This camera cannot provide a usable video mode. Try a different camera, or lower the frame rate.';
    case 'insecure-context':
      return error.message;
    case 'unsupported':
      return error.message;
    default:
      break;
  }

  const message = error?.message || String(error || 'Unknown error');
  if (/wasm|fetch|network|model|404|failed to load/i.test(message)) {
    return `The pose model could not be loaded (${message}). Check the connection and try again; the model is fetched once per visit.`;
  }
  return `The camera or pose model could not start: ${message}${embeddedHint}`;
}

/**
 * Reshape MediaPipe's landmark array into the named points the math uses.
 */
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

// Re-exported from a dependency-free module so it is unit testable in Node.
export { handAboveHead } from './pose-raised.js';

/** Is the whole body (head to feet) in frame right now? */
export function bodyInFrame(points) {
  if (!points) return { ok: false, missing: REQUIRED_POINTS.map(([label]) => label) };
  const missing = REQUIRED_POINTS.filter(([, names]) => !names.every((name) => points[name]?.visible)).map(
    ([label]) => label,
  );
  return { ok: missing.length === 0, missing };
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
