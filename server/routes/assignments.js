import { Router } from 'express';

import { assertCanViewAthlete, assertTherapistLinked } from '../access.js';
import { requireAuth } from '../auth.js';
import { all, get, run } from '../db.js';
import { ApiError, addDays, asyncRoute, text, toInt, todayISO } from '../http.js';
import { ROLES, TEST_LIST } from '../../shared/constants.js';

export const assignmentsRouter = Router();

assignmentsRouter.use(requireAuth);

function shape(row) {
  if (!row) return null;
  let tests = [];
  try {
    tests = JSON.parse(row.tests_json);
  } catch {
    tests = [];
  }
  return {
    id: Number(row.id),
    athleteId: Number(row.athlete_id),
    therapistId: Number(row.therapist_id),
    tests,
    cadenceDays: Number(row.cadence_days),
    nextCheckIn: row.next_check_in,
    note: row.note,
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
}

/** Athletes see their own assignments; a therapist sees an athlete's when linked. */
assignmentsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const athleteId = req.query.athleteId ? Number(req.query.athleteId) : Number(req.user.id);
    assertCanViewAthlete(req.user, athleteId);
    const rows = all(
      'SELECT * FROM assignments WHERE athlete_id = ? ORDER BY active DESC, id DESC',
      athleteId,
    );
    res.json({ assignments: rows.map(shape) });
  }),
);

assignmentsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    if (req.user.role !== ROLES.THERAPIST) {
      throw new ApiError(403, 'Your physical therapist assigns which tests to run.');
    }
    const athleteId = assertTherapistLinked(req.user, req.body?.athleteId);

    const requested = Array.isArray(req.body?.tests) && req.body.tests.length > 0 ? req.body.tests : TEST_LIST;
    const tests = requested.filter((test) => TEST_LIST.includes(test));
    if (tests.length === 0) throw new ApiError(400, 'Choose at least one test from the three supported tests.');

    const cadenceDays = Number(req.body?.cadenceDays ?? 7);
    if (!Number.isFinite(cadenceDays) || cadenceDays < 1 || cadenceDays > 90) {
      throw new ApiError(400, 'Check-in schedule must be between 1 and 90 days.');
    }

    const nextCheckIn = text(req.body?.nextCheckIn, { max: 10 }) || addDays(todayISO(), cadenceDays);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextCheckIn)) {
      throw new ApiError(400, 'Next check-in must be a date in YYYY-MM-DD form.');
    }

    run(
      `INSERT INTO assignments (athlete_id, therapist_id, tests_json, cadence_days, next_check_in, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      athleteId,
      Number(req.user.id),
      JSON.stringify(tests),
      Math.round(cadenceDays),
      nextCheckIn,
      text(req.body?.note, { max: 1000 }),
    );

    const row = get('SELECT * FROM assignments WHERE id = last_insert_rowid()');
    res.status(201).json({ assignment: shape(row) });
  }),
);

assignmentsRouter.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw new ApiError(400, 'A valid assignment id is required.');
    const row = get('SELECT * FROM assignments WHERE id = ?', id);
    if (!row) throw new ApiError(404, 'That assignment does not exist.');

    if (req.user.role === ROLES.ATHLETE) {
      throw new ApiError(403, 'Your physical therapist manages this assignment.');
    }
    assertTherapistLinked(req.user, row.athlete_id);

    const updates = [];
    const params = [];

    if (req.body?.tests !== undefined) {
      const tests = (Array.isArray(req.body.tests) ? req.body.tests : []).filter((test) => TEST_LIST.includes(test));
      if (tests.length === 0) throw new ApiError(400, 'An assignment needs at least one test.');
      updates.push('tests_json = ?');
      params.push(JSON.stringify(tests));
    }
    if (req.body?.cadenceDays !== undefined) {
      const cadenceDays = Number(req.body.cadenceDays);
      if (!Number.isFinite(cadenceDays) || cadenceDays < 1 || cadenceDays > 90) {
        throw new ApiError(400, 'Check-in schedule must be between 1 and 90 days.');
      }
      updates.push('cadence_days = ?');
      params.push(Math.round(cadenceDays));
    }
    if (req.body?.nextCheckIn !== undefined) {
      const nextCheckIn = text(req.body.nextCheckIn, { max: 10 });
      if (!nextCheckIn || !/^\d{4}-\d{2}-\d{2}$/.test(nextCheckIn)) {
        throw new ApiError(400, 'Next check-in must be a date in YYYY-MM-DD form.');
      }
      updates.push('next_check_in = ?');
      params.push(nextCheckIn);
    }
    if (req.body?.note !== undefined) {
      updates.push('note = ?');
      params.push(text(req.body.note, { max: 1000 }));
    }
    if (req.body?.active !== undefined) {
      updates.push('active = ?');
      params.push(req.body.active ? 1 : 0);
    }

    if (updates.length === 0) throw new ApiError(400, 'Nothing to update.');
    params.push(id);
    run(`UPDATE assignments SET ${updates.join(', ')} WHERE id = ?`, ...params);

    res.json({ assignment: shape(get('SELECT * FROM assignments WHERE id = ?', id)) });
  }),
);

assignmentsRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw new ApiError(400, 'A valid assignment id is required.');
    const row = get('SELECT * FROM assignments WHERE id = ?', id);
    if (!row) throw new ApiError(404, 'That assignment does not exist.');
    if (req.user.role !== ROLES.THERAPIST) throw new ApiError(403, 'Your physical therapist manages this assignment.');
    assertTherapistLinked(req.user, row.athlete_id);
    run('DELETE FROM assignments WHERE id = ?', id);
    res.json({ ok: true });
  }),
);
