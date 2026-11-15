import { Router } from 'express';

import { isLinked } from '../access.js';
import { requireAuth } from '../auth.js';
import { all, get, run, transaction } from '../db.js';
import { ApiError, asyncRoute, text, toInt } from '../http.js';
import { PLAN_SAFETY_NOTICE, ROLES } from '../../shared/constants.js';

export const plansRouter = Router();

plansRouter.use(requireAuth);

function shapePlan(row, athleteId) {
  const items = all('SELECT * FROM plan_items WHERE plan_id = ? ORDER BY id', Number(row.id));
  const completions = athleteId
    ? all('SELECT plan_item_id FROM plan_completions WHERE athlete_id = ?', Number(athleteId))
    : [];
  const completed = new Set(completions.map((row2) => Number(row2.plan_item_id)));
  const athlete = get('SELECT id, name FROM users WHERE id = ?', Number(row.athlete_id));
  const therapist = get('SELECT id, name FROM users WHERE id = ?', Number(row.therapist_id));

  return {
    id: Number(row.id),
    createdAt: row.created_at,
    message: row.message,
    safetyNotice: row.safety_notice,
    athlete: athlete ? { id: Number(athlete.id), name: athlete.name } : null,
    therapist: therapist ? { id: Number(therapist.id), name: therapist.name } : null,
    items: items.map((item) => ({
      id: Number(item.id),
      exerciseId: item.exercise_id ? Number(item.exercise_id) : null,
      name: item.name,
      sets: item.sets,
      reps: item.reps,
      instructions: item.instructions,
      completed: completed.has(Number(item.id)),
    })),
  };
}

plansRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const rows =
      req.user.role === ROLES.ATHLETE
        ? all('SELECT * FROM plans WHERE athlete_id = ? ORDER BY created_at DESC, id DESC', Number(req.user.id))
        : all('SELECT * FROM plans WHERE therapist_id = ? ORDER BY created_at DESC, id DESC', Number(req.user.id));
    res.json({
      plans: rows.map((row) => shapePlan(row, req.user.role === ROLES.ATHLETE ? Number(req.user.id) : Number(row.athlete_id))),
    });
  }),
);

plansRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    if (req.user.role !== ROLES.THERAPIST) throw new ApiError(403, 'Only a physical therapist can send a plan.');
    const athleteId = Number(req.body?.athleteId);
    if (!Number.isInteger(athleteId)) throw new ApiError(400, 'Choose the athlete this plan is for.');
    if (!isLinked(req.user.id, athleteId)) {
      throw new ApiError(403, 'You do not have an active link to that athlete.');
    }

    const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (requestedItems.length === 0) throw new ApiError(400, 'Add at least one exercise to the plan.');

    const resolved = [];
    for (const item of requestedItems) {
      const exerciseId = item?.exerciseId != null ? Number(item.exerciseId) : null;
      if (exerciseId) {
        const exercise = get('SELECT * FROM exercises WHERE id = ?', exerciseId);
        if (!exercise) throw new ApiError(404, 'One of those exercises does not exist.');
        const isLibrary = Boolean(exercise.library);
        const isOwn = Number(exercise.owner_therapist_id) === Number(req.user.id);
        if (!isLibrary && !isOwn) throw new ApiError(403, 'You can only use library or your own exercises.');
        resolved.push({
          exerciseId,
          name: text(item.name, { max: 120 }) || exercise.name,
          instructions: text(item.instructions, { max: 1500 }) || exercise.instructions,
          sets: text(item.sets, { max: 40 }),
          reps: text(item.reps, { max: 40 }),
        });
      } else {
        const name = text(item?.name, { max: 120 });
        const instructions = text(item?.instructions, { max: 1500 });
        if (!name || !instructions) throw new ApiError(400, 'Custom exercises need a name and instructions.');
        resolved.push({
          exerciseId: null,
          name,
          instructions,
          sets: text(item.sets, { max: 40 }),
          reps: text(item.reps, { max: 40 }),
        });
      }
    }

    const planId = transaction(() => {
      const info = run(
        'INSERT INTO plans (therapist_id, athlete_id, message, safety_notice) VALUES (?, ?, ?, ?)',
        Number(req.user.id),
        athleteId,
        text(req.body?.message, { max: 2000 }),
        text(req.body?.safetyNotice, { max: 500 }) || PLAN_SAFETY_NOTICE,
      );
      const newId = Number(info.lastInsertRowid);
      for (const item of resolved) {
        run(
          'INSERT INTO plan_items (plan_id, exercise_id, name, sets, reps, instructions) VALUES (?, ?, ?, ?, ?, ?)',
          newId,
          item.exerciseId,
          item.name,
          item.sets,
          item.reps,
          item.instructions,
        );
      }
      return newId;
    });

    res.status(201).json({ plan: shapePlan(get('SELECT * FROM plans WHERE id = ?', planId), athleteId) });
  }),
);

plansRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw new ApiError(400, 'A valid plan id is required.');
    const row = get('SELECT * FROM plans WHERE id = ?', id);
    if (!row) throw new ApiError(404, 'That plan does not exist.');
    const isAthlete = Number(req.user.id) === Number(row.athlete_id);
    const isTherapist = Number(req.user.id) === Number(row.therapist_id);
    if (!isAthlete && !isTherapist) throw new ApiError(403, 'You do not have access to that plan.');
    res.json({ plan: shapePlan(row, Number(row.athlete_id)) });
  }),
);

/** Athlete marks an exercise done (or un-done). */
plansRouter.post(
  '/:id/items/:itemId/complete',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    const itemId = toInt(req.params.itemId);
    if (!id || !itemId) throw new ApiError(400, 'A valid plan and item id are required.');

    const plan = get('SELECT * FROM plans WHERE id = ?', id);
    if (!plan) throw new ApiError(404, 'That plan does not exist.');
    if (Number(plan.athlete_id) !== Number(req.user.id)) {
      throw new ApiError(403, 'Only the athlete on a plan can mark it complete.');
    }
    const item = get('SELECT * FROM plan_items WHERE id = ? AND plan_id = ?', itemId, id);
    if (!item) throw new ApiError(404, 'That exercise is not part of this plan.');

    const completed = req.body?.completed !== false;
    if (completed) {
      run(
        'INSERT OR IGNORE INTO plan_completions (plan_item_id, athlete_id) VALUES (?, ?)',
        itemId,
        Number(req.user.id),
      );
    } else {
      run('DELETE FROM plan_completions WHERE plan_item_id = ? AND athlete_id = ?', itemId, Number(req.user.id));
    }

    res.json({ plan: shapePlan(plan, Number(plan.athlete_id)) });
  }),
);

plansRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw new ApiError(400, 'A valid plan id is required.');
    const plan = get('SELECT * FROM plans WHERE id = ?', id);
    if (!plan) throw new ApiError(404, 'That plan does not exist.');
    if (Number(plan.therapist_id) !== Number(req.user.id)) {
      throw new ApiError(403, 'Only the therapist who sent a plan can delete it.');
    }
    run('DELETE FROM plans WHERE id = ?', id);
    res.json({ ok: true });
  }),
);
