import { all, get } from './db.js';
import { ApiError } from './http.js';

/**
 * Access control. A therapist can only see an athlete's data through an active
 * link that the athlete controls, enforced here on the server for every route.
 */

export function activeLink(therapistId, athleteId) {
  return get(
    `SELECT * FROM links
      WHERE therapist_id = ? AND athlete_id = ? AND revoked_at IS NULL`,
    Number(therapistId),
    Number(athleteId),
  );
}

export function isLinked(therapistId, athleteId) {
  return Boolean(activeLink(therapistId, athleteId));
}

export function linkedAthletes(therapistId) {
  return all(
    `SELECT users.id, users.name, users.email, users.height_cm, users.operated_leg,
            links.id AS link_id, links.created_at AS linked_at
       FROM links JOIN users ON users.id = links.athlete_id
      WHERE links.therapist_id = ? AND links.revoked_at IS NULL
      ORDER BY users.name COLLATE NOCASE`,
    Number(therapistId),
  );
}

export function activeTherapists(athleteId) {
  return all(
    `SELECT users.id, users.name, users.email, links.id AS link_id, links.created_at
       FROM links JOIN users ON users.id = links.therapist_id
      WHERE links.athlete_id = ? AND links.revoked_at IS NULL
      ORDER BY users.name COLLATE NOCASE`,
    Number(athleteId),
  );
}

/** Athletes view themselves; therapists need an active link. */
export function assertCanViewAthlete(viewer, athleteId) {
  const id = Number(athleteId);
  if (!Number.isInteger(id)) throw new ApiError(400, 'A valid athlete id is required.');
  if (viewer.role === 'athlete') {
    if (Number(viewer.id) !== id) throw new ApiError(403, 'You can only view your own data.');
    return;
  }
  if (viewer.role === 'therapist') {
    if (!isLinked(viewer.id, id)) {
      throw new ApiError(403, 'You do not have an active link to that athlete.');
    }
    return;
  }
  throw new ApiError(403, 'Your account cannot view athlete data.');
}

/** Therapists only, and only with an active link. */
export function assertTherapistLinked(viewer, athleteId) {
  if (viewer.role !== 'therapist') throw new ApiError(403, 'Only a physical therapist can do that.');
  const id = Number(athleteId);
  if (!Number.isInteger(id)) throw new ApiError(400, 'A valid athlete id is required.');
  if (!isLinked(viewer.id, id)) throw new ApiError(403, 'You do not have an active link to that athlete.');
  return id;
}
