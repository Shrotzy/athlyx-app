import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';

import { databasePath } from './db.js';
import { errorHandler, notFound } from './http.js';
import { geminiAvailable } from './gemini.js';
import { assignmentsRouter } from './routes/assignments.js';
import { athletesRouter } from './routes/athletes.js';
import { authRouter } from './routes/auth.js';
import { exercisesRouter } from './routes/exercises.js';
import { insightsRouter } from './routes/insights.js';
import { linksRouter } from './routes/links.js';
import { plansRouter } from './routes/plans.js';
import { sessionsRouter } from './routes/sessions.js';

const app = express();
const port = Number(process.env.PORT || 3001);

const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Check-in payloads carry compact landmark frames for skeleton replay.
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, gemini: geminiAvailable(), time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/links', linksRouter);
app.use('/api/assignments', assignmentsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/athletes', athletesRouter);
app.use('/api/exercises', exercisesRouter);
app.use('/api/plans', plansRouter);
app.use('/api/insights', insightsRouter);

app.use('/api', notFound);

// Serve the built client when it exists (single-process deployment).
const distPath = path.resolve('dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use(errorHandler);

app.listen(port, () => {
  console.log(`ATHLYx API listening on http://127.0.0.1:${port}`);
  console.log(`  database: ${databasePath}`);
  console.log(`  gemini:   ${geminiAvailable() ? 'configured (explanations only)' : 'not configured (all scores still work)'}`);
});
