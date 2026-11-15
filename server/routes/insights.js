import { Router } from 'express';

import { isLinked } from '../access.js';
import { requireAuth } from '../auth.js';
import { all, get, run } from '../db.js';
import { ApiError, asyncRoute, rateLimit, toInt } from '../http.js';
import { buildFacts, buildTrialFacts, explainResults, geminiAvailable, summarizeSession } from '../gemini.js';
import { STATUS_LABEL } from '../../shared/constants.js';

export const insightsRouter = Router();

insightsRouter.use(requireAuth);

const explainLimiter = rateLimit({ windowMs: 60_000, max: 8, message: 'Too many explanation requests. Wait a minute.' });
const debriefLimiter = rateLimit({ windowMs: 60_000, max: 4, message: 'Too many summary requests. Wait a minute.' });

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function loadAccessibleSession(user, sessionId) {
  const row = get('SELECT * FROM test_sessions WHERE id = ?', sessionId);
  if (!row) throw new ApiError(404, 'That check-in does not exist.');

  const isOwner = Number(user.id) === Number(row.athlete_id);
  const isLinkedTherapist = user.role === 'therapist' && isLinked(user.id, row.athlete_id);
  if (!isOwner && !isLinkedTherapist) throw new ApiError(403, 'You do not have access to that check-in.');

  return row;
}

const KEY_MESSAGE =
  'AI features need a Gemini API key on the server. All measurements, scores and criteria status are still available without it.';

/**
 * Optional plain-language explanation of an already-scored check-in.
 * Explaining only: the numbers and the criteria status are fixed before this
 * route runs and are never recalculated here.
 */
insightsRouter.post(
  '/explain',
  explainLimiter,
  asyncRoute(async (req, res) => {
    const sessionId = toInt(req.body?.sessionId);
    if (!sessionId) throw new ApiError(400, 'A valid check-in id is required.');

    const row = loadAccessibleSession(req.user, sessionId);
    if (!geminiAvailable()) throw new ApiError(503, KEY_MESSAGE);

    const results = parseJson(row.results_json, {});
    const audience = req.body?.audience === 'therapist' ? 'therapist' : 'athlete';

    try {
      const explanation = await explainResults(results, { audience });
      if (!explanation) throw new Error('Empty response from Gemini.');
      res.json({
        explanation,
        generatedBy: 'gemini',
        note: 'Explains the measured values only; scores and status are unchanged.',
      });
    } catch (error) {
      console.error('[gemini] explanation failed:', error?.message || error);
      throw new ApiError(502, 'The explanation service is unavailable right now. Your measurements are unaffected.');
    }
  }),
);

/**
 * Post-session debrief.
 *
 * The interesting part is everything built *before* the model is called: the
 * per-leg trial counts, the spread within a leg, and the change since the last
 * check-in are computed here from stored data. Gemini receives those numbers as
 * text and is asked to explain them. It never sees raw landmarks and cannot
 * change a score or a status.
 *
 * Debriefs are cached per session and audience: a therapist opening the same
 * check-in twice should not pay for the same paragraph twice.
 */
insightsRouter.post(
  '/debrief',
  debriefLimiter,
  asyncRoute(async (req, res) => {
    const sessionId = toInt(req.body?.sessionId);
    if (!sessionId) throw new ApiError(400, 'A valid check-in id is required.');

    const row = loadAccessibleSession(req.user, sessionId);
    const audience = req.body?.audience === 'therapist' ? 'therapist' : 'athlete';
    const cachedOnly = Boolean(req.body?.cachedOnly);
    const refresh = Boolean(req.body?.refresh);

    if (!refresh) {
      const stored = get(
        'SELECT text, created_at FROM session_debriefs WHERE test_session_id = ? AND audience = ?',
        sessionId,
        audience,
      );
      if (stored) {
        return res.json({
          debrief: stored.text,
          cached: true,
          createdAt: stored.created_at,
          generatedBy: 'gemini',
          note: 'Explains the measured values only; scores and status are unchanged.',
        });
      }
      if (cachedOnly) return res.json({ debrief: null, cached: false, aiAvailable: geminiAvailable() });
    }

    if (!geminiAvailable()) throw new ApiError(503, KEY_MESSAGE);

    const results = parseJson(row.results_json, {});
    const trials = all(
      'SELECT test, leg, trial_no, valid, void_reasons_json, metrics_json FROM trials WHERE test_session_id = ? ORDER BY test, leg, trial_no',
      sessionId,
    ).map((trial) => ({
      test: trial.test,
      leg: trial.leg,
      trialNo: Number(trial.trial_no),
      valid: Boolean(trial.valid),
      voidReasons: parseJson(trial.void_reasons_json, []),
      metrics: parseJson(trial.metrics_json, {}),
    }));

    const facts = [buildFacts(results), ...buildTrialFacts(trials)];

    // How this session compares with the previous one, in fixed arithmetic.
    const previousRow = get(
      'SELECT * FROM test_sessions WHERE athlete_id = ? AND (captured_at < ? OR (captured_at = ? AND id < ?)) ORDER BY captured_at DESC, id DESC LIMIT 1',
      row.athlete_id,
      row.captured_at,
      row.captured_at,
      sessionId,
    );
    if (previousRow) {
      const previous = parseJson(previousRow.results_json, {});
      const delta = (now, before) => {
        if (!Number.isFinite(now) || !Number.isFinite(before)) return 'not comparable';
        const change = Math.round((now - before) * 10) / 10;
        return `${change >= 0 ? '+' : ''}${change}`;
      };
      facts.push(
        [
          `Previous check-in on ${previousRow.captured_at}: status ${STATUS_LABEL[previous.status] || previous.status}.`,
          `Change in single hop LSI: ${delta(results.scores?.singleHop, previous.scores?.singleHop)} points.`,
          `Change in landing quality: ${delta(results.scores?.landing, previous.scores?.landing)} points.`,
        ].join(' '),
      );
    } else {
      facts.push('This is the athlete\'s first recorded check-in, so there is nothing to compare it with.');
    }

    try {
      const debrief = await summarizeSession(facts, { audience });
      if (!debrief) throw new Error('Empty response from Gemini.');

      run(
        `INSERT INTO session_debriefs (test_session_id, audience, text) VALUES (?, ?, ?)
         ON CONFLICT(test_session_id, audience) DO UPDATE SET text = excluded.text, created_at = datetime('now')`,
        sessionId,
        audience,
        debrief,
      );

      res.json({
        debrief,
        cached: false,
        generatedBy: 'gemini',
        note: 'Explains the measured values only; scores and status are unchanged.',
      });
    } catch (error) {
      console.error('[gemini] debrief failed:', error?.message || error);
      throw new ApiError(502, 'The summary service is unavailable right now. Your measurements are unaffected.');
    }
  }),
);
