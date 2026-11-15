import { describe, expect, it } from 'vitest';

import { createHoldGate } from '../src/lib/gesture-gate.js';
import { handsAboveHead } from '../src/lib/pose-raised.js';
import { parseCommand } from '../src/lib/voice-commands.js';
import { AFFIRMATIONS, affirmationFor } from '../src/lib/voice.js';

const point = (x, y, visible = true) => ({ x, y, v: visible ? 1 : 0.1, visible });

const armsUp = {
  nose: point(0.5, 0.18),
  leftShoulder: point(0.42, 0.3),
  rightShoulder: point(0.58, 0.3),
  leftWrist: point(0.34, 0.04),
  rightWrist: point(0.66, 0.04),
};

describe('handsAboveHead (the start position)', () => {
  it('needs both hands above the head', () => {
    expect(handsAboveHead(armsUp)).toMatchObject({ both: true, left: true, right: true });
  });

  it('does not start on one hand alone', () => {
    const oneHand = { ...armsUp, leftWrist: point(0.38, 0.55) };
    expect(handsAboveHead(oneHand)).toMatchObject({ both: false, left: false, right: true });
  });

  it('rejects hands that are only at shoulder height', () => {
    const points = { ...armsUp, leftWrist: point(0.34, 0.28), rightWrist: point(0.66, 0.28) };
    expect(handsAboveHead(points).both).toBe(false);
  });

  it('falls back to the shoulder when the head is not visible', () => {
    const points = { ...armsUp, nose: point(0.5, 0.18, false) };
    expect(handsAboveHead(points).both).toBe(true);
  });

  it('does nothing without usable landmarks', () => {
    expect(handsAboveHead(null).both).toBe(false);
    expect(handsAboveHead({}).both).toBe(false);
    expect(
      handsAboveHead({ ...armsUp, leftWrist: point(0.34, 0.04, false), rightWrist: point(0.66, 0.04, false) }).both,
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
