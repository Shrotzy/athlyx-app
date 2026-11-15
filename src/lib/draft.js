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
  return {
    attempts: trials.length,
    validCount,
    practice: Boolean(draft?.practice?.[draftKey(test, leg)]),
    complete: validCount >= PARAMS.minValidTrials || trials.length >= PARAMS.maxAttempts,
    canRetry: trials.length < PARAMS.maxAttempts,
  };
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
