import { describe, expect, it } from 'vitest';

import { compactLandmarks, decodeLandmarks, encodeFrame, LANDMARK_POINTS } from '../shared/landmarks.js';

describe('compactLandmarks', () => {
  it('returns null for a missing or empty landmark payload', () => {
    expect(compactLandmarks(undefined)).toBeNull();
    expect(compactLandmarks(null)).toBeNull();
    expect(compactLandmarks({})).toBeNull();
    expect(compactLandmarks({ frames: [] })).toBeNull();
  });

  it('keeps the named points and downsamples long trials', () => {
    const frames = Array.from({ length: 720 }, () => encodeFrame([]));
    const compact = compactLandmarks({ frames, fps: 60 });
    expect(compact.points).toEqual(LANDMARK_POINTS);
    expect(compact.fps).toBe(60);
    expect(compact.frames.length).toBe(360);
  });

  it('round-trips a decoded frame for replay', () => {
    // MediaPipe emits 33 landmarks; the hip is index 23.
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.25, y: 0.75, visibility: 0.9 }));
    const compact = compactLandmarks({ frames: [encodeFrame(landmarks)], fps: 30 });
    const decoded = decodeLandmarks(compact);
    expect(decoded.frames[0].leftHip).toMatchObject({ x: 0.25, y: 0.75, visible: true });
  });
});
