/**
 * Optional Gemini helper.
 *
 * Scope is deliberately narrow: it explains numbers that were already scored by
 * shared/scoring.js, or drafts wording for the therapist to edit. It is never
 * asked to calculate a score, decide a criteria status, or choose exercises.
 */

import { GoogleGenAI } from '@google/genai';
import { STATUS_LABEL, TESTS } from '../shared/constants.js';

const apiKey = process.env.GEMINI_API_KEY || '';
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let client = null;

export function geminiAvailable() {
  return Boolean(apiKey);
}

function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

/** Compact, factual description of a scored session for the prompt. */
export function buildFacts(results) {
  const score = (value) => (typeof value === 'number' ? `${value}%` : 'not scored');
  const lines = [
    `Status: ${STATUS_LABEL[results.status] || results.status}`,
    `Single hop LSI: ${score(results.scores?.singleHop)}`,
    `Crossover hop LSI: ${score(results.scores?.crossoverHop)}`,
    `Single-leg landing quality: ${score(results.scores?.landing)}`,
  ];

  const landing = results.tests?.[TESTS.SINGLE_LEG_LANDING];
  if (landing?.markers) {
    lines.push(`Valgus score: ${score(landing.markers.valgusScore)}`);
    lines.push(`Trunk score: ${score(landing.markers.trunkScore)}`);
  }
  if (results.supporting?.kneeFlexionDeg?.ratio != null) {
    lines.push(`Landing knee flexion ratio: ${results.supporting.kneeFlexionDeg.ratio}% (supporting only)`);
  }
  if (results.supporting?.forwardTrunkLeanDeg?.ratio != null) {
    lines.push(`Forward trunk lean ratio: ${results.supporting.forwardTrunkLeanDeg.ratio}% (supporting only)`);
  }
  for (const item of results.responsible || []) lines.push(`Flag: ${item.reason}`);
  for (const note of results.notes || []) lines.push(`Note: ${note}`);
  if (results.trendScore != null) lines.push(`Trend score: ${results.trendScore}%`);
  return lines.join('\n');
}

const SYSTEM_INSTRUCTION = `You help explain results from ATHLYx, a camera-based movement symmetry monitoring tool used by rehabilitating athletes and their physical therapists.

Rules you must follow:
- Explain only the numbers you are given. Never recalculate, estimate or invent a value.
- Never state or imply a diagnosis, healing progress, readiness for sport, or return-to-sport clearance.
- Never suggest exercises, sets, reps or a treatment plan.
- The app's criteria status comes from fixed rules and is final; do not reinterpret it.
- Describe movement symmetry and how it changed, in neutral plain language.
- Mention that scores can fall within measurement noise from a 2D camera.
- Keep it to 3 short paragraphs at most and end by saying the therapist reviews the results.`;

/**
 * Per-test, per-leg counts and spread. Computed here from stored trials so the
 * model is only ever paraphrasing numbers that already exist.
 */
export function buildTrialFacts(trials = []) {
  const grouped = new Map();
  for (const trial of trials) {
    const key = `${trial.test} / ${trial.leg}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(trial);
  }

  const lines = [];
  for (const [key, list] of grouped) {
    const valid = list.filter((trial) => trial.valid);
    const voided = list.length - valid.length;
    let line = `${key}: ${list.length} attempts, ${valid.length} valid, ${voided} voided`;

    const distances = valid
      .map((trial) => trial.metrics?.hopDistanceCm)
      .filter((value) => Number.isFinite(value));
    if (distances.length > 1) {
      const lowest = Math.min(...distances);
      const highest = Math.max(...distances);
      line += `; hop distances ${lowest} to ${highest} cm (spread ${Math.round((highest - lowest) * 10) / 10} cm)`;
    }

    const flexions = valid
      .map((trial) => trial.metrics?.kneeFlexionDeg)
      .filter((value) => Number.isFinite(value));
    if (flexions.length > 1) {
      line += `; landing knee flexion ${Math.min(...flexions)} to ${Math.max(...flexions)} degrees`;
    }

    const valgus = valid.map((trial) => trial.metrics?.valgusDeg).filter((value) => Number.isFinite(value));
    if (valgus.length > 1) {
      line += `; peak valgus ${Math.min(...valgus)} to ${Math.max(...valgus)} degrees`;
    }

    const reasons = [...new Set(list.flatMap((trial) => trial.voidReasons || []))];
    if (reasons.length > 0) line += `; reasons trials were voided: ${reasons.join(', ')}`;
    lines.push(line);
  }
  return lines;
}

const DEBRIEF_INSTRUCTION = `You write a short spoken debrief after one ATHLYx check-in, read aloud to a rehabilitating athlete or their physical therapist at the end of a session.

Rules you must follow:
- Use only the numbers you are given. Never calculate, estimate, average or invent a value.
- Never state or imply a diagnosis, healing status, readiness for sport, or return-to-sport clearance.
- Never prescribe exercises, sets, reps, loading or a treatment plan.
- The app's criteria status comes from fixed rules and is final; do not reinterpret or contradict it.
- Be concrete: refer to the tests, the legs and the numbers by name.
- Say plainly when a result is within measurement noise from a 2D camera, and when fewer valid trials make a score less certain.
- Write 3 to 4 short sentences, then one final sentence naming what the therapist should look at. No headings, no bullet points, no lists.
- Address the athlete as "you" when the audience is the athlete; otherwise address the therapist.
- Do not end by offering further help, and do not mention that you are an AI model.`;

/**
 * Post-session debrief. Explains a session that has already been scored, plus
 * how it compares with the previous one. Never scores anything.
 */
export async function summarizeSession(facts, { audience = 'athlete' } = {}) {
  if (!geminiAvailable()) return null;

  const prompt = `Audience: ${audience === 'therapist' ? 'physical therapist' : 'the athlete'}.\n\nEverything below was measured and scored before you were called:\n${facts.join('\n')}`;

  const response = await getClient().models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: DEBRIEF_INSTRUCTION,
      temperature: 0.35,
      maxOutputTokens: 600,
    },
  });

  const text = response?.text?.trim();
  return text || null;
}

export async function explainResults(results, { audience = 'athlete' } = {}) {
  if (!geminiAvailable()) return null;

  const prompt = `Audience: ${audience === 'therapist' ? 'physical therapist' : 'the athlete'}.\n\nMeasured session values:\n${buildFacts(results)}`;

  const response = await getClient().models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.4,
      maxOutputTokens: 500,
    },
  });

  const text = response?.text?.trim();
  return text || null;
}
