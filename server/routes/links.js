import crypto from 'node:crypto';
import { Router } from 'express';

import { activeTherapists, linkedAthletes } from '../access.js';
import { findUserById, requireAuth, requireRole } from '../auth.js';
import { all, get, run } from '../db.js';
import { ApiError, asyncRoute, text, toInt } from '../http.js';
import { ROLES } from '../../shared/constants.js';

export const linksRouter = Router();

linksRouter.use(requireAuth);

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

/** The athlete's live invite code, created on first request. */
linksRouter.get(
  '/code',
  requireRole(ROLES.ATHLETE),
  asyncRoute(async (req, res) => {
    const existing = get(
      `SELECT * FROM link_codes
        WHERE athlete_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      Number(req.user.id),
    );
    if (existing) {
      return res.json({ code: existing.code, createdAt: existing.created_at });
    }
    let code = newCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = get('SELECT id FROM link_codes WHERE code = ?', code);
      if (!clash) break;
      code = newCode();
    }
    run('INSERT INTO link_codes (code, athlete_id) VALUES (?, ?)', code, Number(req.user.id));
    return res.status(201).json({ code, createdAt: new Date().toISOString() });
  }),
);

/** Rotate the invite code — the old one stops working. */
linksRouter.post(
  '/code/rotate',
  requireRole(ROLES.ATHLETE),
  asyncRoute(async (req, res) => {
    run(
      'UPDATE link_codes SET revoked_at = ? WHERE athlete_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL',
      new Date().toISOString(),
      Number(req.user.id),
    );
    const code = newCode();
    run('INSERT INTO link_codes (code, athlete_id) VALUES (?, ?)', code, Number(req.user.id));
    res.status(201).json({ code });
  }),
);

linksRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    if (req.user.role === ROLES.ATHLETE) {
      return res.json({
        therapists: activeTherapists(req.user.id).map((row) => ({
          linkId: Number(row.link_id),
          id: Number(row.id),
          name: row.name,
          email: row.email,
          linkedAt: row.created_at,
        })),
      });
    }
    return res.json({
      athletes: linkedAthletes(req.user.id).map((row) => ({
        linkId: Number(row.link_id),
        id: Number(row.id),
        name: row.name,
        email: row.email,
        heightCm: row.height_cm,
        operatedLeg: row.operated_leg,
        linkedAt: row.linked_at,
      })),
    });
  }),
);

linksRouter.post(
  '/redeem',
  requireRole(ROLES.THERAPIST),
  asyncRoute(async (req, res) => {
    const raw = text(req.body?.code, { max: 12 });
    if (!raw) throw new ApiError(400, 'Enter the invite code from your athlete.');
    const code = raw.toUpperCase();

    const codeRow = get(
      `SELECT * FROM link_codes
        WHERE code = ? AND redeemed_at IS NULL AND revoked_at IS NULL`,
      code,
    );
    if (!codeRow) throw new ApiError(404, 'That invite code is not valid any more. Ask your athlete for a new one.');

    const athlete = findUserById(codeRow.athlete_id);
    if (!athlete) throw new ApiError(404, 'That athlete account no longer exists.');

    const existing = get(
      'SELECT * FROM links WHERE athlete_id = ? AND therapist_id = ? AND revoked_at IS NULL',
      Number(athlete.id),
      Number(req.user.id),
    );
    if (existing) throw new ApiError(409, 'You are already linked to that athlete.');

    const now = new Date().toISOString();
    run('UPDATE link_codes SET redeemed_at = ? WHERE id = ?', now, Number(codeRow.id));
    const info = run(
      'INSERT INTO links (athlete_id, therapist_id, code_id) VALUES (?, ?, ?)',
      Number(athlete.id),
      Number(req.user.id),
      Number(codeRow.id),
    );

    res.status(201).json({
      linkId: Number(info.lastInsertRowid),
      athlete: { id: Number(athlete.id), name: athlete.name, email: athlete.email },
    });
  }),
);

/** Revoke a link. Either party may do it; the athlete always controls access. */
linksRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const linkId = toInt(req.params.id);
    if (!linkId) throw new ApiError(400, 'A valid link id is required.');

    const link = get('SELECT * FROM links WHERE id = ?', linkId);
    if (!link) throw new ApiError(404, 'That link does not exist.');
    const isParty =
      Number(req.user.id) === Number(link.athlete_id) || Number(req.user.id) === Number(link.therapist_id);
    if (!isParty) throw new ApiError(403, 'Only the athlete or the therapist on a link can revoke it.');

    run('UPDATE links SET revoked_at = ? WHERE id = ?', new Date().toISOString(), linkId);
    res.json({ ok: true });
  }),
);

/** Athlete-only: see every code ever issued, for transparency. */
linksRouter.get(
  '/codes',
  requireRole(ROLES.ATHLETE),
  asyncRoute(async (req, res) => {
    const rows = all(
      'SELECT code, created_at, redeemed_at, revoked_at FROM link_codes WHERE athlete_id = ? ORDER BY id DESC',
      Number(req.user.id),
    );
    res.json({
      codes: rows.map((row) => ({
        code: row.code,
        createdAt: row.created_at,
        redeemedAt: row.redeemed_at,
        revokedAt: row.revoked_at,
      })),
    });
  }),
);
