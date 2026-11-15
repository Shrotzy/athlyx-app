import { describe, expect, it } from 'vitest';

import { createHoldGate } from '../src/lib/gesture-gate.js';
import { handAboveHead } from '../src/lib/pose-raised.js';
import { parseCommand } from '../src/lib/voice-commands.js';
import { AFFIRMATIONS, affirmationFor } from '../src/lib/voice.js';

const point = (x, y, visible = true) => ({ x, y, v: visible ? 1 : 0.1, visible });

describe('handAboveHead (the start position)', () => {
  it('accepts a right hand above the head', () => {
    const points = {
      nose: point(0.5, 0.18),
      leftShoulder: point(0.42, 0.3),
      rightShoulder: point(0.58, 0.3),
      rightWrist: point(0.62, 0.05),
    };
    expect(handAboveHead(points)).toMatchObject({ any: true, right: true, left: false });
  });

  it('accepts either hand, for a shoulder that cannot lift', () => {
    const points = {
      nose: point(0.5, 0.18),
      leftShoulder: point(0.42, 0.3),
      leftWrist: point(0.38, 0.06),
    };
    expect(handAboveHead(points)).toMatchObject({ any: true, left: true, right: false });
  });

  it('rejects a hand that is only at shoulder height', () => {
    const points = {
      nose: point(0.5, 0.18),
      leftShoulder: point(0.42, 0.3),
      rightShoulder: point(0.58, 0.3),
      rightWrist: point(0.62, 0.28),
    };
    expect(handAboveHead(points).any).toBe(false);
  });

  it('falls back to the shoulder when the head is not visible', () => {
    const points = {
      nose: point(0.5, 0.18, false),
      rightShoulder: point(0.58, 0.3),
      rightWrist: point(0.62, 0.08),
    };
    expect(handAboveHead(points).right).toBe(true);
  });

  it('does nothing without usable landmarks', () => {
    expect(handAboveHead(null).any).toBe(false);
    expect(handAboveHead({}).any).toBe(false);
    expect(handAboveHead({ nose: point(0.5, 0.18), rightWrist: point(0.6, 0.05, false) }).any).toBe(false);
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
