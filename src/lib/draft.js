import { PARAMS, TEST_LIST, LEG_LIST } from '@shared/constants.js';
import { isValidTrial } from '@shared/validation.js';

const KEY = 'athlyx.draft.v1';

export function loadDraft() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft?.trials || !Array.isArray(draft.trials)) return null;
    return draft;
  } catch {
    return null;
  }
}

export function saveDraft(draft) {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* a huge draft may not fit; the check-in still works within this page */
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function draftKey(test, leg) {
  return `${test}:${leg}`;
}

export function startDraft({ assignmentId = null, tests = TEST_LIST, operatedLeg = null }) {
  const draft = {
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    startedAt: new Date().toISOString(),
    assignmentId,
    tests: tests.filter((test) => TEST_LIST.includes(test)),
    operatedLeg,
    trials: [],
    practice: {},
    noisy: false,
  };
  saveDraft(draft);
  return draft;
}

export function appendTrial(draft, trial) {
  const next = { ...draft, trials: [...draft.trials, trial] };
  saveDraft(next);
  return next;
}

export function markPracticeDone(draft, test, leg) {
  const next = { ...draft, practice: { ...draft.practice, [draftKey(test, leg)]: true } };
  saveDraft(next);
  return next;
}

export function trialsFor(draft, test, leg) {
  return (draft?.trials || []).filter((trial) => trial.test === test && trial.leg === leg);
}

export function progressFor(draft, test, leg) {
  const trials = trialsFor(draft, test, leg);
  const validCount = trials.filter(isValidTrial).length;
  const attempts = trials.length;
  // Completion is about *valid* trials only. Counting attempts as completion
  // used to lock a leg the moment six voided attempts were made: the start
  // button went dead and the athlete could never recover.
  const complete = validCount >= PARAMS.minValidTrials;
  return {
    attempts,
    validCount,
    practice: Boolean(draft?.practice?.[draftKey(test, leg)]),
    complete,
    exhausted: !complete && attempts >= PARAMS.maxAttempts,
    attemptsLeft: Math.max(0, PARAMS.maxAttempts - attempts),
    canRetry: !complete && attempts < PARAMS.maxAttempts,
  };
}

/** Start one test on one leg again: clears only that leg's trials. */
export function resetLeg(draft, test, leg) {
  const next = {
    ...draft,
    trials: (draft.trials || []).filter((trial) => !(trial.test === test && trial.leg === leg)),
    practice: { ...draft.practice, [draftKey(test, leg)]: false },
  };
  saveDraft(next);
  return next;
}

/** Remove the most recent attempt for one leg, so a mis-start need not use the budget. */
export function dropLastTrial(draft, test, leg) {
  const trials = [...(draft.trials || [])];
  for (let index = trials.length - 1; index >= 0; index -= 1) {
    if (trials[index].test === test && trials[index].leg === leg) {
      trials.splice(index, 1);
      break;
    }
  }
  const remaining = trials.filter((trial) => trial.test === test && trial.leg === leg).length;
  const next = {
    ...draft,
    trials,
    // If that was the only attempt, the practice trial has to be redone too.
    practice: remaining === 0 ? { ...draft.practice, [draftKey(test, leg)]: false } : draft.practice,
  };
  saveDraft(next);
  return next;
}

/** Completion for every test/leg in the draft, used by the check-in overview. */
export function draftOverview(draft) {
  const rows = [];
  for (const test of draft?.tests?.length ? draft.tests : TEST_LIST) {
    for (const leg of LEG_LIST) {
      rows.push({ test, leg, ...progressFor(draft, test, leg) });
    }
  }
  const complete = rows.every((row) => row.complete);
  const started = rows.some((row) => row.attempts > 0);
  return { rows, complete, started };
}
