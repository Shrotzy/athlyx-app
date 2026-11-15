/**
 * Demo seed.
 *
 * Creates a linked therapist/athlete pair, an assignment, three synthetic
 * check-ins on an improving trend, a plan, and the starter exercise library.
 * Everything is synthetic — no volunteer or patient data.
 *
 *   npm run seed
 */

import 'dotenv/config';
import crypto from 'node:crypto';

import { hashPassword } from './auth.js';
import { all, get, run, transaction } from './db.js';
import { encodeFrame, LANDMARK_POINTS } from '../shared/landmarks.js';
import { evaluateSession } from '../shared/scoring.js';
import { PARAMS, TESTS, LEGS, PLAN_SAFETY_NOTICE } from '../shared/constants.js';

const DEMO_PASSWORD = 'athlyx-demo';
const THERAPIST = { name: 'Priya Raman', email: 'therapist@athlyx.demo' };
const ATHLETE = { name: 'Maya Chen', email: 'athlete@athlyx.demo' };

const LIBRARY = [
  {
    name: 'Split squat (supported)',
    stage: 'Mid-stage — controlled loading',
    instructions:
      'Hold a rail for balance. Lower until the front knee is near 90 degrees, keep the knee tracking over the middle toes, then press back up slowly. 2-3 sets of 8-10 per leg.',
    source: 'Demo library — verify stage and dose against your clinic protocol',
  },
  {
    name: 'Single-leg balance reach',
    stage: 'Early to mid-stage — proprioception',
    instructions:
      'Stand on one leg with a soft knee. Reach the other foot forward, to the side and behind without letting the standing knee collapse inward. 2 sets of 5 reaches per direction.',
    source: 'Demo library — verify stage and dose against your clinic protocol',
  },
  {
    name: 'Lateral band walk',
    stage: 'Early to mid-stage — hip control',
    instructions:
      'Band above the knees, quarter-squat stance. Step sideways keeping the knees from falling inward. 3 sets of 10 steps each way.',
    source: 'Demo library — verify stage and dose against your clinic protocol',
  },
  {
    name: 'Step-down with knee alignment',
    stage: 'Mid-stage — eccentric control',
    instructions:
      'From a low step, lower slowly on one leg while watching the knee stay over the second toe. Touch down lightly and press back up. 2-3 sets of 6-8 per leg.',
    source: 'Demo library — verify stage and dose against your clinic protocol',
  },
  {
    name: 'Low-amplitude pogo hops',
    stage: 'Late-stage — plyometric preparation',
    instructions:
      'Small, quiet two-legged hops in place, landing softly with bent knees. Keep it pain-free and stop if the knee feels unstable. 3 sets of 10.',
    source: 'Demo library — verify stage and dose against your clinic protocol',
  },
  {
    name: 'Landing mechanics drill (front view)',
    stage: 'Late-stage — landing control',
    instructions:
      'Step off a low step and stick the landing on one leg, keeping the knee over the toes and the trunk upright. Film from the front to check inward knee collapse. 3 sets of 5 per leg.',
    source: 'Demo library — verify stage and dose against your clinic protocol',
  },
];

/** Build a plausible stick-figure sequence so replay works on demo data. */
function syntheticLandmarks(test, progress) {
  const frames = [];
  const fps = 50;
  const total = 55;

  for (let index = 0; index < total; index += 1) {
    const t = index / (total - 1);
    const inAir = t > 0.25 && t < 0.6;
    const landCrouch = t >= 0.6 ? (1 - Math.cos(Math.min(1, (t - 0.6) / 0.25) * Math.PI)) / 2 : 0;
    const flight = inAir ? Math.sin(((t - 0.25) / 0.35) * Math.PI) : 0;
    const travel = test === TESTS.SINGLE_LEG_LANDING ? 0 : progress * 0.16 * Math.min(1, Math.max(0, (t - 0.25) / 0.5));

    const baseY = 0.42;
    const hipY = baseY - 0.05 * flight + 0.09 * landCrouch;
    const shoulderY = hipY - 0.16 + 0.02 * landCrouch;
    const kneeY = hipY + 0.17 + 0.03 * landCrouch;
    const ankleY = inAir ? hipY + 0.3 - 0.06 * flight : 0.78;
    const heelY = ankleY + 0.02;
    const toeY = ankleY + 0.02;

    const inward = test === TESTS.SINGLE_LEG_LANDING ? 0.05 * progress * landCrouch : 0;
    const midX = 0.48;

    const points = {
      leftShoulder: [midX - 0.03 + travel, shoulderY],
      rightShoulder: [midX + 0.03 + travel, shoulderY],
      leftHip: [midX - 0.03 + travel, hipY],
      rightHip: [midX + 0.03 + travel, hipY],
      leftKnee: [midX - 0.03 + travel + inward, kneeY],
      rightKnee: [midX + 0.03 + travel + inward, kneeY],
      leftAnkle: [midX - 0.03 + travel, ankleY],
      rightAnkle: [midX + 0.03 + travel, ankleY],
      leftHeel: [midX - 0.05 + travel, heelY],
      rightHeel: [midX + 0.01 + travel, heelY],
      leftToe: [midX + 0.02 + travel, toeY],
      rightToe: [midX + 0.08 + travel, toeY],
    };

    const landmarkArray = LANDMARK_POINTS.map(() => ({ x: 0, y: 0, visibility: 1 }));
    for (const [name, [x, y]] of Object.entries(points)) {
      const index = LANDMARK_POINTS.indexOf(name);
      landmarkArray[index] = { x, y, visibility: 0.95 };
    }
    frames.push(encodeFrame(landmarkArray));
  }

  return { points: LANDMARK_POINTS, fps, frames };
}

function makeTrials({ singleHop, crossoverHop, operatedValgus, healthyValgus, operatedTrunk, healthyTrunk }) {
  const trials = [];
  const triple = (value) => [value, value + 2, value - 2];

  for (const distance of triple(singleHop.operated)) {
    trials.push({
      test: TESTS.SINGLE_HOP,
      leg: LEGS.OPERATED,
      trialNo: trials.filter((t) => t.test === TESTS.SINGLE_HOP && t.leg === LEGS.OPERATED).length + 1,
      valid: true,
      voidReasons: [],
      metrics: { hopDistanceCm: distance, kneeFlexionDeg: 66, forwardTrunkLeanDeg: 24 },
      landmarks: syntheticLandmarks(TESTS.SINGLE_HOP, 1),
      durationMs: 1400,
    });
  }
  for (const distance of triple(singleHop.healthy)) {
    trials.push({
      test: TESTS.SINGLE_HOP,
      leg: LEGS.HEALTHY,
      trialNo: trials.filter((t) => t.test === TESTS.SINGLE_HOP && t.leg === LEGS.HEALTHY).length + 1,
      valid: true,
      voidReasons: [],
      metrics: { hopDistanceCm: distance, kneeFlexionDeg: 74, forwardTrunkLeanDeg: 21 },
      landmarks: syntheticLandmarks(TESTS.SINGLE_HOP, 1),
      durationMs: 1400,
    });
  }
  for (const distance of triple(crossoverHop.operated)) {
    trials.push({
      test: TESTS.CROSSOVER_HOP,
      leg: LEGS.OPERATED,
      trialNo: trials.filter((t) => t.test === TESTS.CROSSOVER_HOP && t.leg === LEGS.OPERATED).length + 1,
      valid: true,
      voidReasons: [],
      metrics: { hopDistanceCm: distance, kneeFlexionDeg: 64, forwardTrunkLeanDeg: 24 },
      landmarks: syntheticLandmarks(TESTS.CROSSOVER_HOP, 2),
      durationMs: 2100,
    });
  }
  for (const distance of triple(crossoverHop.healthy)) {
    trials.push({
      test: TESTS.CROSSOVER_HOP,
      leg: LEGS.HEALTHY,
      trialNo: trials.filter((t) => t.test === TESTS.CROSSOVER_HOP && t.leg === LEGS.HEALTHY).length + 1,
      valid: true,
      voidReasons: [],
      metrics: { hopDistanceCm: distance, kneeFlexionDeg: 73, forwardTrunkLeanDeg: 21 },
      landmarks: syntheticLandmarks(TESTS.CROSSOVER_HOP, 2),
      durationMs: 2100,
    });
  }
  for (const [leg, valgus, trunk] of [
    [LEGS.OPERATED, operatedValgus, operatedTrunk],
    [LEGS.HEALTHY, healthyValgus, healthyTrunk],
  ]) {
    for (let index = 0; index < 3; index += 1) {
      trials.push({
        test: TESTS.SINGLE_LEG_LANDING,
        leg,
        trialNo: trials.filter((t) => t.test === TESTS.SINGLE_LEG_LANDING && t.leg === leg).length + 1,
        valid: true,
        voidReasons: [],
        metrics: { valgusDeg: valgus, trunkLeanDeg: trunk },
        landmarks: syntheticLandmarks(TESTS.SINGLE_LEG_LANDING, leg === LEGS.OPERATED ? 1 : 0.3),
        durationMs: 1300,
      });
    }
  }
  return trials;
}

function storeSession(athleteId, assignmentId, capturedAt, trials, { noisy = false } = {}) {
  const results = evaluateSession({ trials, noisy });
  const info = run(
    `INSERT INTO test_sessions (athlete_id, assignment_id, captured_at, camera_setup, results_json, status, trend_score, noisy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    athleteId,
    assignmentId,
    capturedAt,
    'side',
    JSON.stringify(results),
    results.status,
    results.trendScore,
    noisy ? 1 : 0,
  );
  const sessionId = Number(info.lastInsertRowid);

  for (const trial of trials) {
    run(
      `INSERT INTO trials (test_session_id, test, leg, trial_no, valid, void_reasons_json, metrics_json, landmarks_json, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      trial.test,
      trial.leg,
      trial.trialNo,
      trial.valid ? 1 : 0,
      JSON.stringify(trial.voidReasons),
      JSON.stringify(trial.metrics),
      JSON.stringify(trial.landmarks),
      trial.durationMs,
    );
  }
  return sessionId;
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function daysAhead(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seed() {
  // Idempotent: remove previous demo accounts (cascades to their data).
  run('DELETE FROM users WHERE email IN (?, ?)', THERAPIST.email, ATHLETE.email);

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const therapistId = Number(
    run(
      'INSERT INTO users (role, name, email, password_hash) VALUES (?, ?, ?, ?)',
      'therapist',
      THERAPIST.name,
      THERAPIST.email,
      passwordHash,
    ).lastInsertRowid,
  );
  const athleteId = Number(
    run(
      'INSERT INTO users (role, name, email, password_hash, height_cm, operated_leg) VALUES (?, ?, ?, ?, ?, ?)',
      'athlete',
      ATHLETE.name,
      ATHLETE.email,
      passwordHash,
      170,
      'right',
    ).lastInsertRowid,
  );

  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const codeId = Number(
    run(
      'INSERT INTO link_codes (code, athlete_id, redeemed_at) VALUES (?, ?, ?)',
      code,
      athleteId,
      new Date().toISOString(),
    ).lastInsertRowid,
  );
  run(
    'INSERT INTO links (athlete_id, therapist_id, code_id) VALUES (?, ?, ?)',
    athleteId,
    therapistId,
    codeId,
  );

  const assignmentId = Number(
    run(
      `INSERT INTO assignments (athlete_id, therapist_id, tests_json, cadence_days, next_check_in, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      athleteId,
      therapistId,
      JSON.stringify([TESTS.SINGLE_HOP, TESTS.CROSSOVER_HOP, TESTS.SINGLE_LEG_LANDING]),
      14,
      daysAhead(5),
      'Cleared for hop testing. Repeat every two weeks until the next review.',
    ).lastInsertRowid,
  );

  const sessions = [
    {
      days: 42,
      trials: makeTrials({
        singleHop: { operated: 145, healthy: 168 },
        crossoverHop: { operated: 380, healthy: 450 },
        operatedValgus: 12,
        healthyValgus: 5,
        operatedTrunk: 10,
        healthyTrunk: 6,
      }),
    },
    {
      days: 28,
      trials: makeTrials({
        singleHop: { operated: 156, healthy: 170 },
        crossoverHop: { operated: 410, healthy: 460 },
        operatedValgus: 9,
        healthyValgus: 5,
        operatedTrunk: 8,
        healthyTrunk: 6,
      }),
    },
    {
      days: 14,
      trials: makeTrials({
        singleHop: { operated: 165, healthy: 172 },
        crossoverHop: { operated: 440, healthy: 460 },
        operatedValgus: 6,
        healthyValgus: 5,
        operatedTrunk: 7,
        healthyTrunk: 6,
      }),
    },
  ];

  const sessionIds = transaction(() =>
    sessions.map((session) => storeSession(athleteId, assignmentId, daysAgo(session.days), session.trials)),
  );

  // A voided trial and a note on the middle session, so the review screen shows real states.
  const middleSession = sessionIds[1];
  const middleTrial = get(
    `SELECT * FROM trials WHERE test_session_id = ? AND test = ? AND leg = 'operated' ORDER BY trial_no LIMIT 1`,
    middleSession,
    TESTS.SINGLE_LEG_LANDING,
  );
  if (middleTrial) {
    run(
      'INSERT INTO trial_notes (trial_id, therapist_id, note) VALUES (?, ?, ?)',
      Number(middleTrial.id),
      therapistId,
      'Knee drops inward on this landing and the trunk leans left. Watch the replay at the moment of contact.',
    );
    run(
      'INSERT INTO decisions (test_session_id, therapist_id, decision, note) VALUES (?, ?, ?, ?)',
      middleSession,
      therapistId,
      'retest',
      'Keep working on landing alignment; re-test in two weeks.',
    );
  }

  // Starter library.
  const libraryCount = Number(get('SELECT COUNT(*) AS count FROM exercises WHERE library = 1').count || 0);
  if (libraryCount === 0) {
    for (const exercise of LIBRARY) {
      run(
        `INSERT INTO exercises (owner_therapist_id, name, stage, instructions, source, library)
         VALUES (NULL, ?, ?, ?, ?, 1)`,
        exercise.name,
        exercise.stage,
        exercise.instructions,
        exercise.source,
      );
    }
  }

  // One plan, with the first exercise already completed.
  const planId = Number(
    run(
      'INSERT INTO plans (therapist_id, athlete_id, message, safety_notice) VALUES (?, ?, ?, ?)',
      therapistId,
      athleteId,
      'Your hop distances look good. The main thing to work on is keeping the knee from collapsing inward when you land. Do these before your next check-in and tick them off.',
      PLAN_SAFETY_NOTICE,
    ).lastInsertRowid,
  );

  const planExercises = all('SELECT * FROM exercises WHERE library = 1 ORDER BY id LIMIT 3');
  for (const [index, exercise] of planExercises.entries()) {
    const itemId = Number(
      run(
        'INSERT INTO plan_items (plan_id, exercise_id, name, sets, reps, instructions) VALUES (?, ?, ?, ?, ?, ?)',
        planId,
        Number(exercise.id),
        exercise.name,
        index === 0 ? '2' : '3',
        index === 0 ? '8 per leg' : '10',
        exercise.instructions,
      ).lastInsertRowid,
    );
    if (index === 0) {
      run('INSERT INTO plan_completions (plan_item_id, athlete_id) VALUES (?, ?)', itemId, athleteId);
    }
  }

  const latest = get(
    'SELECT status, trend_score FROM test_sessions WHERE athlete_id = ? ORDER BY captured_at DESC LIMIT 1',
    athleteId,
  );

  console.log('ATHLYx demo data seeded.');
  console.log(`  therapist  ${THERAPIST.email} / ${DEMO_PASSWORD}`);
  console.log(`  athlete    ${ATHLETE.email} / ${DEMO_PASSWORD}`);
  console.log(`  link code  ${code}`);
  console.log(`  sessions   ${sessionIds.length} (latest: ${latest?.status}, trend ${latest?.trend_score}%)`);
  console.log(`  params     target ${PARAMS.targetScore}%, borderline ${PARAMS.borderlineLow}-${PARAMS.borderlineHigh}%`);
}

await seed();
