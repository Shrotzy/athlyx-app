import { Router } from 'express';

import { requireAuth, requireRole } from '../auth.js';
import { all, get, run } from '../db.js';
import { ApiError, asyncRoute, text, toInt } from '../http.js';
import { ROLES } from '../../shared/constants.js';

export const exercisesRouter = Router();

exercisesRouter.use(requireAuth);

function shape(row) {
  return {
    id: Number(row.id),
    name: row.name,
    stage: row.stage,
    instructions: row.instructions,
    source: row.source,
    sourceUrl: row.source_url,
    library: Boolean(row.library),
    custom: !row.library,
    ownerTherapistId: row.owner_therapist_id ? Number(row.owner_therapist_id) : null,
  };
}

/** Shared library plus the therapist's own exercises. */
exercisesRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const library = all('SELECT * FROM exercises WHERE library = 1 ORDER BY name COLLATE NOCASE');
    const own =
      req.user.role === ROLES.THERAPIST
        ? all(
            'SELECT * FROM exercises WHERE owner_therapist_id = ? AND library = 0 ORDER BY name COLLATE NOCASE',
            Number(req.user.id),
          )
        : [];
    res.json({ library: library.map(shape), custom: own.map(shape) });
  }),
);

exercisesRouter.post(
  '/',
  requireRole(ROLES.THERAPIST),
  asyncRoute(async (req, res) => {
    const name = text(req.body?.name, { max: 120 });
    const instructions = text(req.body?.instructions, { max: 2000 });
    if (!name) throw new ApiError(400, 'Give the exercise a name.');
    if (!instructions) throw new ApiError(400, 'Describe how to perform the exercise.');

    const info = run(
      `INSERT INTO exercises (owner_therapist_id, name, stage, instructions, source, library)
       VALUES (?, ?, ?, ?, ?, 0)`,
      Number(req.user.id),
      name,
      text(req.body?.stage, { max: 80 }),
      instructions,
      'Therapist-created',
    );
    res.status(201).json({ exercise: shape(get('SELECT * FROM exercises WHERE id = ?', Number(info.lastInsertRowid))) });
  }),
);

exercisesRouter.delete(
  '/:id',
  requireRole(ROLES.THERAPIST),
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw new ApiError(400, 'A valid exercise id is required.');
    const row = get('SELECT * FROM exercises WHERE id = ?', id);
    if (!row) throw new ApiError(404, 'That exercise does not exist.');
    if (row.library) throw new ApiError(403, 'Library exercises cannot be deleted.');
    if (Number(row.owner_therapist_id) !== Number(req.user.id)) {
      throw new ApiError(403, 'You can only delete your own exercises.');
    }
    run('DELETE FROM exercises WHERE id = ?', id);
    res.json({ ok: true });
  }),
);
