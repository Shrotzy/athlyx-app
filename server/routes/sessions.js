import { Router } from 'express';

import { assertCanViewAthlete, assertTherapistLinked, isLinked } from '../access.js';
import { requireAuth } from '../auth.js';
import { all, get, run, transaction } from '../db.js';
import { ApiError, addDays, asyncRoute, text, toInt, todayISO } from '../http.js';
import { compactLandmarks } from '../../shared/landmarks.js';
import { evaluateSession } from '../../shared/scoring.js';
import {
  CAMERA_SETUPS,
  isValidTrial,
  normalizeVoidReasons,
  validateSessionPayload,
} from '../../shared/validation.js';
import { DECISIONS } from '../../shared/constants.js';

export const sessionsRouter = Router();

sessionsRouter.use(requireAuth);

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function shapeListRow(row) {
  const results = parseJson(row.results_json, {});
  return {
    id: Number(row.id),
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    cameraSetup: row.camera_setup,
    status: row.status,
    statusLabel: results.statusLabel || row.status,
    trendScore: row.trend_score,
    scores: results.scores || {},
    responsible: results.responsible || [],
    trialSummary: results.trialSummary || null,
    noisy: Boolean(row.noisy),
  };
}

function sessionDetail(id) {
  const row = get(
    `SELECT test_sessions.*, users.name AS athlete_name, users.operated_leg
       FROM test_sessions JOIN users ON users.id = test_sessions.athlete_id
      WHERE test_sessions.id = ?`,
    id,
  );
  if (!row) return null;

  const noteRows = all(
    `SELECT trial_notes.id, trial_notes.trial_id, trial_notes.note, trial_notes.created_at,
            users.name AS therapist_name
       FROM trial_notes
       JOIN trials ON trials.id = trial_notes.trial_id
       JOIN users ON users.id = trial_notes.therapist_id
      WHERE trials.test_session_id = ?
      ORDER BY trial_notes.id`,
    id,
  );

  const notesByTrial = new Map();
  for (const note of noteRows) {
    const key = Number(note.trial_id);
    if (!notesByTrial.has(key)) notesByTrial.set(key, []);
    notesByTrial.get(key).push({
      id: Number(note.id),
      note: note.note,
      createdAt: note.created_at,
      therapistName: note.therapist_name,
    });
  }

  const trialRows = all('SELECT * FROM trials WHERE test_session_id = ? ORDER BY test, leg, trial_no', id);
  const decisionRow = get(
    `SELECT decisions.*, users.name AS therapist_name
       FROM decisions JOIN users ON users.id = decisions.therapist_id
      WHERE decisions.test_session_id = ?
      ORDER BY decisions.id DESC LIMIT 1`,
    id,
  );

  return {
    id: Number(row.id),
    athlete: {
      id: Number(row.athlete_id),
      name: row.athlete_name,
      operatedLeg: row.operated_leg,
    },
    assignmentId: row.assignment_id ? Number(row.assignment_id) : null,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    cameraSetup: row.camera_setup,
    noisy: Boolean(row.noisy),
    results: parseJson(row.results_json, {}),
    trials: trialRows.map((trial) => ({
      id: Number(trial.id),
      test: trial.test,
      leg: trial.leg,
      trialNo: Number(trial.trial_no),
      valid: Boolean(trial.valid),
      voidReasons: parseJson(trial.void_reasons_json, []),
      metrics: parseJson(trial.metrics_json, {}),
      landmarks: parseJson(trial.landmarks_json, null),
      durationMs: trial.duration_ms,
      notes: notesByTrial.get(Number(trial.id)) || [],
    })),
    decision: decisionRow
      ? {
          id: Number(decisionRow.id),
          decision: decisionRow.decision,
          note: decisionRow.note,
          createdAt: decisionRow.created_at,
          therapistName: decisionRow.therapist_name,
        }
      : null,
  };
}

function assertSessionAccess(viewer, sessionRow) {
  if (viewer.role === 'athlete') {
    if (Number(viewer.id) !== Number(sessionRow.athlete_id)) {
      throw new ApiError(403, 'You can only view your own check-ins.');
    }
    return;
  }
  if (!isLinked(viewer.id, sessionRow.athlete_id)) {
    throw new ApiError(403, 'You do not have an active link to that athlete.');
  }
}

/**
 * Submit a check-in. Scores are recomputed here from the submitted trial
 * measurements — the client's own summary is never trusted.
 */
sessionsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    if (req.user.role !== 'athlete') {
      throw new ApiError(403, 'Only athletes submit check-ins.');
    }

    const body = req.body || {};
    const trials = Array.isArray(body.trials) ? body.trials : [];

    const validation = validateSessionPayload({ trials });
    if (!validation.ok) {
      throw new ApiError(400, 'That check-in could not be scored. Nothing was saved.', validation.errors);
    }

    let assignment = null;
    if (body.assignmentId != null && body.assignmentId !== '') {
      assignment = get(
        'SELECT * FROM assignments WHERE id = ? AND athlete_id = ?',
        Number(body.assignmentId),
        Number(req.user.id),
      );
      if (!assignment) throw new ApiError(404, 'That assignment does not exist.');
    }

    const cameraSetup = body.cameraSetup === CAMERA_SETUPS.FRONT ? CAMERA_SETUPS.FRONT : body.cameraSetup === CAMERA_SETUPS.SIDE ? CAMERA_SETUPS.SIDE : null;
    const capturedAt = text(body.capturedAt, { max: 40 }) || new Date().toISOString();
    if (Number.isNaN(Date.parse(capturedAt))) throw new ApiError(400, 'capturedAt must be an ISO date.');

    const noisy = Boolean(body.noisy);
    const results = evaluateSession({ trials, noisy });

    const sessionId = transaction(() => {
      const info = run(
        `INSERT INTO test_sessions (athlete_id, assignment_id, captured_at, camera_setup, results_json, status, trend_score, noisy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        Number(req.user.id),
        assignment ? Number(assignment.id) : null,
        capturedAt,
        cameraSetup,
        JSON.stringify(results),
        results.status,
        results.trendScore,
        noisy ? 1 : 0,
      );
      const newId = Number(info.lastInsertRowid);

      for (const trial of trials) {
        run(
          `INSERT INTO trials (test_session_id, test, leg, trial_no, valid, void_reasons_json, metrics_json, landmarks_json, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          newId,
          trial.test,
          trial.leg,
          Number(trial.trialNo),
          isValidTrial(trial) ? 1 : 0,
          JSON.stringify(normalizeVoidReasons(trial.voidReasons)),
          JSON.stringify(trial.metrics || {}),
          JSON.stringify(compactLandmarks(trial.landmarks) || null),
          Number.isFinite(Number(trial.durationMs)) ? Math.round(Number(trial.durationMs)) : null,
        );
      }

      if (assignment) {
        run(
          'UPDATE assignments SET next_check_in = ? WHERE id = ?',
          addDays(todayISO(), assignment.cadence_days),
          Number(assignment.id),
        );
      }

      return newId;
    });

    res.status(201).json({ session: sessionDetail(sessionId) });
  }),
);

sessionsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const athleteId = req.query.athleteId ? Number(req.query.athleteId) : Number(req.user.id);
    assertCanViewAthlete(req.user, athleteId);

    const limit = Math.min(Math.max(toInt(req.query.limit, 30), 1), 100);
    const rows = all(
      'SELECT * FROM test_sessions WHERE athlete_id = ? ORDER BY captured_at DESC, id DESC LIMIT ?',
      athleteId,
      limit,
    );
    res.json({ sessions: rows.map(shapeListRow) });
  }),
);

/** Trend series for the progress chart. */
sessionsRouter.get(
  '/progress',
  asyncRoute(async (req, res) => {
    const athleteId = req.query.athleteId ? Number(req.query.athleteId) : Number(req.user.id);
    assertCanViewAthlete(req.user, athleteId);

    const rows = all(
      'SELECT id, captured_at, status, trend_score, results_json FROM test_sessions WHERE athlete_id = ? ORDER BY captured_at ASC, id ASC',
      athleteId,
    );

    res.json({
      points: rows.map((row) => {
        const results = parseJson(row.results_json, {});
        return {
          sessionId: Number(row.id),
          date: row.captured_at,
          singleHop: results.scores?.singleHop ?? null,
          landing: results.scores?.landing ?? null,
          trend: row.trend_score,
          status: row.status,
        };
      }),
    });
  }),
);

sessionsRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw new ApiError(400, 'A valid check-in id is required.');
    const row = get('SELECT * FROM test_sessions WHERE id = ?', id);
    if (!row) throw new ApiError(404, 'That check-in does not exist.');
    assertSessionAccess(req.user, row);
    res.json({ session: sessionDetail(id) });
  }),
);

/** The athlete can delete a single check-in. */
sessionsRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw new ApiError(400, 'A valid check-in id is required.');
    const row = get('SELECT * FROM test_sessions WHERE id = ?', id);
    if (!row) throw new ApiError(404, 'That check-in does not exist.');
    if (Number(req.user.id) !== Number(row.athlete_id)) {
      throw new ApiError(403, 'Only the athlete who recorded a check-in can delete it.');
    }
    run('DELETE FROM test_sessions WHERE id = ?', id);
    res.json({ ok: true });
  }),
);

/** Therapist note on one trial. */
sessionsRouter.post(
  '/:id/notes',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw new ApiError(400, 'A valid check-in id is required.');
    const row = get('SELECT * FROM test_sessions WHERE id = ?', id);
    if (!row) throw new ApiError(404, 'That check-in does not exist.');
    assertTherapistLinked(req.user, row.athlete_id);

    const trialId = toInt(req.body?.trialId);
    if (!trialId) throw new ApiError(400, 'Choose the trial this note belongs to.');
    const trial = get('SELECT * FROM trials WHERE id = ? AND test_session_id = ?', trialId, id);
    if (!trial) throw new ApiError(404, 'That trial is not part of this check-in.');

    const note = text(req.body?.note, { max: 2000 });
    if (!note) throw new ApiError(400, 'Write a note before saving.');

    run(
      'INSERT INTO trial_notes (trial_id, therapist_id, note) VALUES (?, ?, ?)',
      trialId,
      Number(req.user.id),
      note,
    );
    res.status(201).json({ session: sessionDetail(id) });
  }),
);

sessionsRouter.delete(
  '/:id/notes/:noteId',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    const noteId = toInt(req.params.noteId);
    if (!id || !noteId) throw new ApiError(400, 'A valid check-in and note id are required.');
    const row = get('SELECT * FROM test_sessions WHERE id = ?', id);
    if (!row) throw new ApiError(404, 'That check-in does not exist.');
    assertTherapistLinked(req.user, row.athlete_id);

    const note = get(
      `SELECT trial_notes.* FROM trial_notes
         JOIN trials ON trials.id = trial_notes.trial_id
        WHERE trial_notes.id = ? AND trials.test_session_id = ?`,
      noteId,
      id,
    );
    if (!note) throw new ApiError(404, 'That note does not exist.');
    if (Number(note.therapist_id) !== Number(req.user.id)) {
      throw new ApiError(403, 'You can only delete your own notes.');
    }
    run('DELETE FROM trial_notes WHERE id = ?', noteId);
    res.json({ session: sessionDetail(id) });
  }),
);

/** Therapist decision for the session: confirm, defer or re-test. */
sessionsRouter.post(
  '/:id/decision',
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw new ApiError(400, 'A valid check-in id is required.');
    const row = get('SELECT * FROM test_sessions WHERE id = ?', id);
    if (!row) throw new ApiError(404, 'That check-in does not exist.');
    assertTherapistLinked(req.user, row.athlete_id);

    const decision = req.body?.decision;
    if (!Object.values(DECISIONS).includes(decision)) {
      throw new ApiError(400, 'Decision must be confirm, defer or re-test.');
    }
    const note = text(req.body?.note, { max: 2000 });

    run(
      'INSERT INTO decisions (test_session_id, therapist_id, decision, note) VALUES (?, ?, ?, ?)',
      id,
      Number(req.user.id),
      decision,
      note,
    );
    res.status(201).json({ session: sessionDetail(id) });
  }),
);
