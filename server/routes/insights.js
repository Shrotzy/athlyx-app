import { Router } from 'express';

import { isLinked } from '../access.js';
import { requireAuth } from '../auth.js';
import { get } from '../db.js';
import { ApiError, asyncRoute, rateLimit, toInt } from '../http.js';
import { explainResults, geminiAvailable } from '../gemini.js';

export const insightsRouter = Router();

insightsRouter.use(requireAuth);

const explainLimiter = rateLimit({ windowMs: 60_000, max: 8, message: 'Too many explanation requests. Wait a minute.' });

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

    const row = get('SELECT * FROM test_sessions WHERE id = ?', sessionId);
    if (!row) throw new ApiError(404, 'That check-in does not exist.');

    const isOwner = Number(req.user.id) === Number(row.athlete_id);
    const isTherapist = req.user.role === 'therapist' && isLinked(req.user.id, row.athlete_id);
    if (!isOwner && !isTherapist) throw new ApiError(403, 'You do not have access to that check-in.');

    if (!geminiAvailable()) {
      throw new ApiError(
        503,
        'Plain-language explanations need a Gemini API key on the server. All measurements and scores are still available.',
      );
    }

    const results = JSON.parse(row.results_json);
    const audience = req.body?.audience === 'therapist' ? 'therapist' : 'athlete';

    try {
      const explanation = await explainResults(results, { audience });
      if (!explanation) throw new Error('Empty response from Gemini.');
      res.json({ explanation, generatedBy: 'gemini', note: 'Explains the measured values only; scores and status are unchanged.' });
    } catch (error) {
      console.error('[gemini] explanation failed:', error?.message || error);
      throw new ApiError(502, 'The explanation service is unavailable right now. Your measurements are unaffected.');
    }
  }),
);
