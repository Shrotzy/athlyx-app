import { Router } from 'express';

import { linkedAthletes } from '../access.js';
import { requireAuth, requireRole } from '../auth.js';
import { all, get } from '../db.js';
import { asyncRoute } from '../http.js';
import { ROLES } from '../../shared/constants.js';

export const athletesRouter = Router();

athletesRouter.use(requireAuth);

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Therapist's patient list: latest status, trend, next check-in and plan progress. */
athletesRouter.get(
  '/',
  requireRole(ROLES.THERAPIST),
  asyncRoute(async (req, res) => {
    const rows = linkedAthletes(req.user.id);

    const athletes = rows.map((athlete) => {
      const latest = get(
        `SELECT id, captured_at, status, trend_score, results_json
           FROM test_sessions WHERE athlete_id = ?
          ORDER BY captured_at DESC, id DESC LIMIT 1`,
        Number(athlete.id),
      );
      const previous = get(
        `SELECT trend_score, captured_at FROM test_sessions WHERE athlete_id = ?
          ORDER BY captured_at DESC, id DESC LIMIT 1 OFFSET 1`,
        Number(athlete.id),
      );
      const assignment = get(
        'SELECT * FROM assignments WHERE athlete_id = ? AND active = 1 ORDER BY id DESC LIMIT 1',
        Number(athlete.id),
      );
      const plan = get(
        'SELECT * FROM plans WHERE athlete_id = ? ORDER BY id DESC LIMIT 1',
        Number(athlete.id),
      );
      const planTotals = plan
        ? get(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN plan_completions.id IS NULL THEN 0 ELSE 1 END) AS done
               FROM plan_items
               LEFT JOIN plan_completions
                 ON plan_completions.plan_item_id = plan_items.id AND plan_completions.athlete_id = ?
              WHERE plan_items.plan_id = ?`,
            Number(athlete.id),
            Number(plan.id),
          )
        : null;

      const results = latest ? parseJson(latest.results_json, {}) : null;

      return {
        id: Number(athlete.id),
        name: athlete.name,
        email: athlete.email,
        operatedLeg: athlete.operated_leg,
        heightCm: athlete.height_cm,
        linkedAt: athlete.linked_at,
        latest: latest
          ? {
              sessionId: Number(latest.id),
              capturedAt: latest.captured_at,
              status: latest.status,
              statusLabel: results?.statusLabel || latest.status,
              trendScore: latest.trend_score,
              scores: results?.scores || {},
              responsible: results?.responsible || [],
            }
          : null,
        previousTrend: previous?.trend_score ?? null,
        nextCheckIn: assignment?.next_check_in ?? null,
        assignment: assignment
          ? {
              id: Number(assignment.id),
              tests: parseJson(assignment.tests_json, []),
              cadenceDays: Number(assignment.cadence_days),
              note: assignment.note,
            }
          : null,
        planProgress: planTotals
          ? { planId: Number(plan.id), done: Number(planTotals.done || 0), total: Number(planTotals.total || 0) }
          : null,
        sessionCount: Number(
          get('SELECT COUNT(*) AS count FROM test_sessions WHERE athlete_id = ?', Number(athlete.id))?.count || 0,
        ),
      };
    });

    res.json({ athletes });
  }),
);

/** Single athlete summary card. */
athletesRouter.get(
  '/:id',
  requireRole(ROLES.THERAPIST),
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const linked = all(
      `SELECT users.* FROM links JOIN users ON users.id = links.athlete_id
        WHERE links.therapist_id = ? AND links.athlete_id = ? AND links.revoked_at IS NULL`,
      Number(req.user.id),
      id,
    );
    if (linked.length === 0) {
      return res.status(403).json({ error: 'You do not have an active link to that athlete.' });
    }
    const athlete = linked[0];
    res.json({
      athlete: {
        id: Number(athlete.id),
        name: athlete.name,
        email: athlete.email,
        operatedLeg: athlete.operated_leg,
        heightCm: athlete.height_cm,
      },
    });
  }),
);
