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
