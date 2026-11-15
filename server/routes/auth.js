import { Router } from 'express';

import { createSession, destroySession, hashPassword, publicUser, requireAuth, verifyPassword } from '../auth.js';
import { get, run } from '../db.js';
import { ApiError, asyncRoute, rateLimit, text } from '../http.js';
import { ROLES, SIDES } from '../../shared/constants.js';
import { validateEmail, validatePassword } from '../../shared/validation.js';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 60_000, max: 12, message: 'Too many sign-in attempts. Wait a minute.' });

function shapeProfile(row) {
  const user = publicUser(row);
  if (!user) return null;
  return {
    ...user,
    operatedSide: user.operatedLeg === SIDES.RIGHT ? 'right' : user.operatedLeg === SIDES.LEFT ? 'left' : null,
  };
}

authRouter.post(
  '/signup',
  loginLimiter,
  asyncRoute(async (req, res) => {
    const { name, email, password, role } = req.body || {};

    const cleanName = text(name, { max: 120 });
    if (!cleanName) throw new ApiError(400, 'Please enter your name.');
    if (!validateEmail(email)) throw new ApiError(400, 'Please enter a valid email address.');
    const passwordProblem = validatePassword(password);
    if (passwordProblem) throw new ApiError(400, passwordProblem);
    if (role !== ROLES.ATHLETE && role !== ROLES.THERAPIST) {
      throw new ApiError(400, 'Choose whether this is an athlete or a physical therapist account.');
    }

    const existing = get('SELECT id FROM users WHERE email = ?', String(email).trim());
    if (existing) throw new ApiError(409, 'An account with that email already exists.');

    const passwordHash = await hashPassword(password);
    const info = run(
      'INSERT INTO users (role, name, email, password_hash) VALUES (?, ?, ?, ?)',
      role,
      cleanName,
      String(email).trim(),
      passwordHash,
    );
    const userId = Number(info.lastInsertRowid);
    const session = createSession(userId);
    const row = get('SELECT * FROM users WHERE id = ?', userId);

    res.status(201).json({ token: session.token, expiresAt: session.expiresAt, user: shapeProfile(row) });
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};
    if (!validateEmail(email) || typeof password !== 'string') {
      throw new ApiError(400, 'Enter your email and password.');
    }
    const row = get('SELECT * FROM users WHERE email = ?', String(email).trim());
    const ok = row ? await verifyPassword(password, row.password_hash) : false;
    if (!ok) throw new ApiError(401, 'That email and password do not match.');

    const session = createSession(Number(row.id));
    res.json({ token: session.token, expiresAt: session.expiresAt, user: shapeProfile(row) });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncRoute(async (req, res) => {
    destroySession(req.authToken);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ user: shapeProfile(req.user) });
  }),
);

/** Athlete profile fields used for hop-distance scaling and leg mapping. */
authRouter.patch(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { name, heightCm, operatedLeg } = req.body || {};
    const updates = [];
    const params = [];

    if (name !== undefined) {
      const cleanName = text(name, { max: 120 });
      if (!cleanName) throw new ApiError(400, 'Name cannot be empty.');
      updates.push('name = ?');
      params.push(cleanName);
    }

    if (heightCm !== undefined && heightCm !== null && heightCm !== '') {
      const height = Number(heightCm);
      if (!Number.isFinite(height) || height < 90 || height > 250) {
        throw new ApiError(400, 'Height must be between 90 and 250 cm.');
      }
      updates.push('height_cm = ?');
      params.push(height);
    }

    if (operatedLeg !== undefined) {
      if (operatedLeg !== null && operatedLeg !== SIDES.LEFT && operatedLeg !== SIDES.RIGHT) {
        throw new ApiError(400, 'Operated leg must be left, right or empty.');
      }
      updates.push('operated_leg = ?');
      params.push(operatedLeg);
    }

    if (updates.length === 0) throw new ApiError(400, 'Nothing to update.');

    params.push(Number(req.user.id));
    run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...params);
    const row = get('SELECT * FROM users WHERE id = ?', Number(req.user.id));
    res.json({ user: shapeProfile(row) });
  }),
);

/** Delete the account and everything derived from it. */
authRouter.delete(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    run('DELETE FROM users WHERE id = ?', Number(req.user.id));
    res.json({ ok: true });
  }),
);
