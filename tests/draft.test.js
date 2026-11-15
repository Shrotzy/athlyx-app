import { describe, expect, it } from 'vitest';

import { dropLastTrial, progressFor, resetLeg } from '../src/lib/draft.js';
import { PARAMS } from '../shared/constants.js';

const valid = (trialNo = 1, test = 'single-hop', leg = 'operated') => ({
  test,
  leg,
  trialNo,
  valid: true,
  voidReasons: [],
  metrics: { hopDistanceCm: 100 },
});

const voided = (trialNo = 1, test = 'single-hop', leg = 'operated') => ({
  test,
  leg,
  trialNo,
  valid: false,
  voidReasons: ['tracking-lost'],
  metrics: {},
});

const draftWith = (trials, practice = {}) => ({ trials, practice });

describe('progressFor', () => {
  it('is complete only when enough trials are valid', () => {
    const progress = progressFor(draftWith([valid(1), valid(2), valid(3)]), 'single-hop', 'operated');
    expect(progress.complete).toBe(true);
    expect(progress.exhausted).toBe(false);
    expect(progress.attemptsLeft).toBe(PARAMS.maxAttempts - 3);
  });

  it('never treats used-up attempts as completion', () => {
    const trials = Array.from({ length: PARAMS.maxAttempts }, (_, index) => voided(index + 1));
    const progress = progressFor(draftWith(trials), 'single-hop', 'operated');
    // This was the bug: six voided attempts marked the leg complete and the
    // start button dead, with nothing valid recorded.
    expect(progress.complete).toBe(false);
    expect(progress.exhausted).toBe(true);
    expect(progress.validCount).toBe(0);
    expect(progress.attemptsLeft).toBe(0);
  });

  it('is not exhausted while attempts remain', () => {
    const progress = progressFor(draftWith([valid(1), voided(2)]), 'single-hop', 'operated');
    expect(progress.complete).toBe(false);
    expect(progress.exhausted).toBe(false);
    expect(progress.attemptsLeft).toBe(PARAMS.maxAttempts - 2);
  });

  it('counts each test and leg separately', () => {
    const draft = draftWith([
      valid(1, 'single-hop', 'operated'),
      valid(2, 'single-hop', 'operated'),
      valid(3, 'single-hop', 'operated'),
    ]);
    expect(progressFor(draft, 'single-hop', 'operated').complete).toBe(true);
    expect(progressFor(draft, 'single-hop', 'healthy').complete).toBe(false);
    expect(progressFor(draft, 'crossover-hop', 'operated').complete).toBe(false);
  });
});

describe('recovery helpers', () => {
  it('resetLeg clears only the selected test and leg', () => {
    const draft = draftWith(
      [valid(1), valid(2), valid(1, 'single-hop', 'healthy'), voided(3)],
      { 'single-hop:operated': true },
    );
    const next = resetLeg(draft, 'single-hop', 'operated');
    expect(next.trials).toHaveLength(1);
    expect(next.trials[0].leg).toBe('healthy');
    expect(next.practice['single-hop:operated']).toBe(false);
    expect(progressFor(next, 'single-hop', 'operated').attempts).toBe(0);
  });

  it('dropLastTrial removes only the newest attempt for that leg', () => {
    const draft = draftWith([valid(1), valid(2), valid(3, 'single-hop', 'healthy')]);
    const next = dropLastTrial(draft, 'single-hop', 'operated');
    // The newest operated-leg attempt goes; the healthy-leg trial is untouched.
    expect(next.trials.map((trial) => trial.leg)).toEqual(['operated', 'healthy']);
  });

  it('dropLastTrial re-opens the practice trial when nothing is left', () => {
    const draft = draftWith([voided(1)], { 'single-hop:operated': true });
    const next = dropLastTrial(draft, 'single-hop', 'operated');
    expect(next.trials).toHaveLength(0);
    expect(next.practice['single-hop:operated']).toBe(false);
  });
});
