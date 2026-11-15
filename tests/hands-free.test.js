import { describe, expect, it } from 'vitest';

import { createHoldGate } from '../src/lib/gesture-gate.js';
import { handsOnHead } from '../src/lib/start-pose.js';
import { parseCommand } from '../src/lib/voice-commands.js';
import { AFFIRMATIONS, affirmationFor } from '../src/lib/voice.js';

const point = (x, y, visible = true) => ({ x, y, v: visible ? 1 : 0.1, visible });

const handsOnHeadPoints = {
  nose: point(0.5, 0.2),
  leftShoulder: point(0.42, 0.3),
  rightShoulder: point(0.58, 0.3),
  leftWrist: point(0.42, 0.16),
  rightWrist: point(0.58, 0.16),
};

describe('handsOnHead (the start position)', () => {
  it('fires with both hands resting on the head', () => {
    expect(handsOnHead(handsOnHeadPoints)).toMatchObject({ both: true, left: true, right: true });
  });

  it('needs both hands, so one hand cannot start a trial', () => {
    const oneHand = { ...handsOnHeadPoints, rightWrist: point(0.62, 0.62) };
    expect(handsOnHead(oneHand)).toMatchObject({ both: false, left: true, right: false });
  });

  it('rejects arms held straight up, which is what left the frame', () => {
    const overhead = { ...handsOnHeadPoints, leftWrist: point(0.42, 0.02), rightWrist: point(0.58, 0.02) };
    expect(handsOnHead(overhead).both).toBe(false);
  });

  it('rejects hands at chest height or down by the sides', () => {
    expect(handsOnHead({ ...handsOnHeadPoints, leftWrist: point(0.42, 0.42), rightWrist: point(0.58, 0.42) }).both).toBe(
      false,
    );
    expect(handsOnHead({ ...handsOnHeadPoints, leftWrist: point(0.4, 0.66), rightWrist: point(0.6, 0.66) }).both).toBe(
      false,
    );
  });

  it('falls back to the shoulders when the face is not visible', () => {
    expect(handsOnHead({ ...handsOnHeadPoints, nose: point(0.5, 0.2, false) }).both).toBe(true);
  });

  it('does nothing without usable landmarks', () => {
    expect(handsOnHead(null).both).toBe(false);
    expect(handsOnHead({}).both).toBe(false);
    expect(
      handsOnHead({
        ...handsOnHeadPoints,
        leftWrist: point(0.42, 0.16, false),
        rightWrist: point(0.58, 0.16, false),
      }).both,
    ).toBe(false);
  });
});

describe('hold gate', () => {
  it('fires once the position has been held long enough', () => {
    const gate = createHoldGate({ holdMs: 600 });
    expect(gate.update(true, 0).fired).toBe(false);
    expect(gate.update(true, 300).fired).toBe(false);
    expect(gate.update(true, 650).fired).toBe(true);
    // Still held: no second start.
    expect(gate.update(true, 1200).fired).toBe(false);
  });

  it('reports progress so the screen can ask the athlete to keep holding', () => {
    const gate = createHoldGate({ holdMs: 600 });
    expect(gate.update(true, 0).progress).toBe(0);
    expect(gate.update(true, 300).progress).toBeCloseTo(0.5, 5);
  });

  it('needs the hand lowered before it can fire again', () => {
    const gate = createHoldGate({ holdMs: 400, cooldownMs: 0 });
    expect(gate.update(true, 0).fired).toBe(false);
    expect(gate.update(true, 450).fired).toBe(true);
    gate.update(false, 500);
    expect(gate.update(true, 600).fired).toBe(false);
    expect(gate.update(true, 1100).fired).toBe(true);
  });

  it('ignores a hand that passes through', () => {
    const gate = createHoldGate({ holdMs: 400 });
    gate.update(true, 0);
    gate.update(false, 200);
    expect(gate.update(true, 300).fired).toBe(false);
    expect(gate.update(true, 600).fired).toBe(false);
  });

  it('resets cleanly between trials', () => {
    const gate = createHoldGate({ holdMs: 400, cooldownMs: 0 });
    expect(gate.update(true, 0).fired).toBe(false);
    expect(gate.update(true, 450).fired).toBe(true);
    expect(() => gate.reset()).not.toThrow();
    expect(gate.update(true, 500).fired).toBe(false);
    expect(gate.update(true, 950).fired).toBe(true);
  });
});

describe('voice commands', () => {
  it('recognises the ways people actually say "start"', () => {
    for (const phrase of ['ready to go', 'start', 'Start.', 'okay go', 'ready', 'begin please', 'next one', 'hop']) {
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

describe('affirmations', () => {
  it('never says a clinical result, and cycles instead of repeating', () => {
    expect(affirmationFor(0)).toBe(AFFIRMATIONS[0]);
    expect(affirmationFor(1)).toBe(AFFIRMATIONS[1]);
    expect(affirmationFor(AFFIRMATIONS.length)).toBe(AFFIRMATIONS[0]);
    for (const line of AFFIRMATIONS) {
      expect(line).not.toMatch(/healed|recovered|cleared|ready for sport|progress/i);
    }
  });
});
