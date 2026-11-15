import { describe, expect, it } from 'vitest';

import { createGestureGate, START_GESTURES } from '../src/lib/gesture-gate.js';
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
