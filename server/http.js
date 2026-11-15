/** Small HTTP helpers shared by every route module. */

export class ApiError extends Error {
  constructor(status, message, details = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Wrap an async route so thrown errors reach the error middleware. */
export function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message, details: error.details });
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'The check-in payload was too large to save.' });
  }
  console.error('[api] unhandled error:', error);
  return res.status(500).json({ error: 'Something went wrong on the server. Nothing was saved.' });
}

/** Very small in-memory limiter: enough to slow password guessing in a demo. */
export function rateLimit({ windowMs = 60_000, max = 20, message = 'Too many requests. Try again shortly.' } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }
    return next();
  };
}

export function toInt(value, fallback = null) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) ? number : fallback;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

/** Trimmed string or null. */
export function text(value, { max = 2000 } = {}) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}
