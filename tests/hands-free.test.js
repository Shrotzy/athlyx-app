import { describe, expect, it } from 'vitest';

import { createGestureGate, createHoldGate, START_GESTURES } from '../src/lib/gesture-gate.js';
import { handsRaised } from '../src/lib/pose-raised.js';
import { parseCommand } from '../src/lib/voice-commands.js';

describe('gesture gate', () => {
  it('accepts a thumbs up held long enough and fires exactly once', () => {
    const gate = createGestureGate();
    expect(gate.update('Thumb_Up', 0.9, 0).fired).toBe(false);
    expect(gate.update('Thumb_Up', 0.9, 300).fired).toBe(false);
    expect(gate.update('Thumb_Up', 0.9, 700).fired).toBe(true);
    // Still held: must not fire again.
    expect(gate.update('Thumb_Up', 0.9, 900).fired).toBe(false);
    expect(gate.update('Thumb_Up', 0.9, 1400).fired).toBe(false);
  });

  it('does not fire until the hold time has passed', () => {
    const gate = createGestureGate({ holdMs: 600 });
    expect(gate.update('Open_Palm', 0.8, 0).fired).toBe(false);
    expect(gate.update('Open_Palm', 0.8, 599).fired).toBe(false);
    expect(gate.update('Open_Palm', 0.8, 600).fired).toBe(true);
  });

  it('reports progress so the UI can ask the athlete to keep holding', () => {
    const gate = createGestureGate({ holdMs: 600 });
    expect(gate.update('Thumb_Up', 0.9, 0).progress).toBe(0);
    expect(gate.update('Thumb_Up', 0.9, 300).progress).toBeCloseTo(0.5, 5);
  });

  it('ignores low-confidence and unwanted gestures', () => {
    const gate = createGestureGate({ minScore: 0.6 });
    expect(gate.update('Thumb_Up', 0.4, 0).active).toBe(false);
    expect(gate.update('Victory', 0.99, 0).active).toBe(false);
    expect(gate.update(null, 0, 0).active).toBe(false);
  });

  it('needs the hand to drop before it can fire again', () => {
    const gate = createGestureGate({ cooldownMs: 0 });
    expect(gate.update('Thumb_Up', 0.9, 0).fired).toBe(false);
    expect(gate.update('Thumb_Up', 0.9, 700).fired).toBe(true);
    gate.update(null, 0, 800); // hand lowered
    expect(gate.update('Thumb_Up', 0.9, 900).fired).toBe(false);
    expect(gate.update('Thumb_Up', 0.9, 1600).fired).toBe(true);
  });

  it('treats a change of gesture as a new hold', () => {
    const gate = createGestureGate({ holdMs: 600 });
    expect(gate.update('Thumb_Up', 0.9, 0).fired).toBe(false);
    // The switch restarts the hold, so it fires 600 ms after the change.
    expect(gate.update('Open_Palm', 0.9, 500).fired).toBe(false);
    expect(gate.update('Open_Palm', 0.9, 1000).fired).toBe(false);
    expect(gate.update('Open_Palm', 0.9, 1150).fired).toBe(true);
  });

  it('can be reset between trials', () => {
    const gate = createGestureGate();
    expect(gate.update('Thumb_Up', 0.9, 0).fired).toBe(false);
    expect(gate.update('Thumb_Up', 0.9, 700).fired).toBe(true);
    expect(() => gate.reset()).not.toThrow();
    // A fresh hold after the reset behaves like the first one.
    expect(gate.update('Thumb_Up', 0.9, 1000).fired).toBe(false);
    expect(gate.update('Thumb_Up', 0.9, 1700).fired).toBe(true);
  });

  it('only accepts the two documented start gestures', () => {
    expect(START_GESTURES).toEqual(['Thumb_Up', 'Open_Palm']);
  });
});

describe('raise-hand gate', () => {
  it('fires after the hand has been up long enough, then waits for a release', () => {
    const gate = createHoldGate({ holdMs: 400 });
    expect(gate.update(true, 0).fired).toBe(false);
    expect(gate.update(true, 200).fired).toBe(false);
    expect(gate.update(true, 450).fired).toBe(true);
    expect(gate.update(true, 900).fired).toBe(false);
    gate.update(false, 1000);
    // The 1.2 s cooldown from the first fire has to elapse too.
    expect(gate.update(true, 1100).fired).toBe(false);
    expect(gate.update(true, 1600).fired).toBe(false);
    expect(gate.update(true, 1650).fired).toBe(true);
  });

  it('does not fire for a hand that passes through', () => {
    const gate = createHoldGate({ holdMs: 400 });
    expect(gate.update(true, 0).fired).toBe(false);
    expect(gate.update(true, 200).fired).toBe(false);
    gate.update(false, 250);
    expect(gate.update(true, 300).fired).toBe(false);
    expect(gate.update(true, 600).fired).toBe(false);
    expect(gate.update(true, 850).fired).toBe(true);
  });
});

describe('handsRaised', () => {
  const point = (x, y, visible = true) => ({ x, y, v: 1, visible });

  it('detects a hand above the shoulder on either side', () => {
    const points = {
      leftShoulder: point(0.4, 0.3),
      rightShoulder: point(0.6, 0.3),
      leftWrist: point(0.35, 0.1),
      rightWrist: point(0.65, 0.5),
    };
    expect(handsRaised(points)).toMatchObject({ any: true, left: true, right: false });
  });

  it('ignores a hand at chest height', () => {
    const points = {
      leftShoulder: point(0.4, 0.3),
      rightShoulder: point(0.6, 0.3),
      leftWrist: point(0.35, 0.42),
      rightWrist: point(0.65, 0.45),
    };
    expect(handsRaised(points).any).toBe(false);
  });

  it('needs a visible wrist and shoulder', () => {
    const hidden = { x: 0.3, y: 0.1, v: 0.1, visible: false };
    const points = { leftShoulder: point(0.4, 0.3), leftWrist: hidden };
    expect(handsRaised(points).any).toBe(false);
    expect(handsRaised(null).any).toBe(false);
  });
});

describe('voice commands', () => {
  it('recognises the ways people actually say "start"', () => {
    for (const phrase of ['start', 'Start.', 'okay go', 'ready', 'begin please', 'next one', 'hop']) {
      expect(parseCommand(phrase)).toBe('start');
    }
  });

  it('recognises a request to repeat', () => {
    expect(parseCommand('let me do that again')).toBe('repeat');
  });

  it('ignores ordinary speech and empty transcripts', () => {
    expect(parseCommand('')).toBe(null);
    expect(parseCommand(null)).toBe(null);
    expect(parseCommand('my knee feels fine today')).toBe(null);
  });
});
