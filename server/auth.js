import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

import { get, run } from './db.js';
import { ApiError } from './http.js';

export const SESSION_DAYS = Number(process.env.SESSION_DAYS || 14);

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  run('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, expiresAt);
  return { token, expiresAt };
}

export function destroySession(token) {
  if (token) run('DELETE FROM auth_sessions WHERE token = ?', token);
}

export function bearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Resolve the signed-in user, or null. Expired tokens are deleted on sight. */
export function currentUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const row = get(
    `SELECT auth_sessions.token, auth_sessions.expires_at, users.*
       FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
      WHERE auth_sessions.token = ?`,
    token,
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run('DELETE FROM auth_sessions WHERE token = ?', token);
    return null;
  }
  return row;
}

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }
  req.user = user;
  req.authToken = bearerToken(req);
  return next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Your account type cannot do that.' });
    }
    return next();
  };
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    role: row.role,
    name: row.name,
    email: row.email,
    heightCm: row.height_cm ?? null,
    operatedLeg: row.operated_leg ?? null,
    createdAt: row.created_at,
  };
}

export function findUserByEmail(email) {
  return get('SELECT * FROM users WHERE email = ?', String(email || '').trim());
}

export function findUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', Number(id));
}

export function assertUserIsAthlete(id) {
  const user = findUserById(id);
  if (!user) throw new ApiError(404, 'Athlete not found.');
  if (user.role !== 'athlete') throw new ApiError(400, 'That account is not an athlete account.');
  return user;
}
