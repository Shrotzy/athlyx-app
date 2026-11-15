# ATHLYx

Camera-based lower-limb **movement symmetry** monitoring for athletes recovering from surgery, and the physical therapists who guide them.

The athlete runs three functional tests in front of a live camera in the browser. ATHLYx measures the operated leg against the healthy leg, scores the difference, and gives the therapist the measurements, a skeleton replay of every trial, and tools for notes, decisions and exercise plans.

> **ATHLYx is a monitoring and decision-support aid.** It does not diagnose, does not measure healing and is not a return-to-sport clearance. Video is processed in the browser and never uploaded; only derived measurements and compact landmark sequences are stored.

---

## What is in this repository

This repository is the working foundation for the project described in [docs/SPEC.md](docs/SPEC.md), which is the source of truth for scope, scoring and requirements.

| Area | State |
| --- | --- |
| Scoring engine (LSI, landing quality, criteria status, trend) | Implemented and unit-tested against the worked example in the spec |
| Trial validity rules and server-side payload validation | Implemented |
| Accounts, session tokens, athlete–therapist invite links, revocation | Implemented |
| Assignments and check-in schedules | Implemented |
| Check-in submission, server-side scoring, history and progress series | Implemented |
| Live pose tracking, phase detection, trial capture in the browser | Implemented; pose pipeline and trial loop verified in a real browser (see [Limitations](#limitations)) |
| Therapist review: scores, marker breakdown, trial notes, decision, skeleton replay | Implemented |
| Exercise library, custom exercises, plans, completion tracking | Implemented (library is demo content) |
| Optional plain-language explanations via Gemini | Implemented, off unless a key is set |
| PDF/CSV export, scheduled reminders, native apps | **Not implemented** |

---

## Quick start

Requirements: **Node.js 24 or newer** (the server uses the built-in `node:sqlite`), npm, and a browser with camera access.

```bash
npm install
cp .env.example .env          # optional: add GEMINI_API_KEY here
npm run seed                  # demo therapist + athlete, 3 check-ins, a plan
npm run dev                   # API on :3001, Vite on :5173
```

Open http://localhost:5173. Demo accounts created by the seed:

| Role | Email | Password |
| --- | --- | --- |
| Physical therapist | `therapist@athlyx.demo` | `athlyx-demo` |
| Athlete | `athlete@athlyx.demo` | `athlyx-demo` |

The seed is idempotent: it deletes and recreates the two demo accounts (and everything linked to them) each time. All seeded data is synthetic.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API (with `--watch`) and Vite together |
| `npm run dev:api` / `npm run dev:web` | One side only |
| `npm test` | Vitest unit tests for the measurement and scoring maths |
| `npm run seed` | Reset and seed demo data |
| `npm run build` | Build the client into `dist/` |
| `npm start` | Serve API **and** the built client from one process (`dist/` must exist) |

Camera access requires a secure context: `localhost` works, and a deployed instance must be served over **HTTPS**.

### If the camera does not start

The runner checks the browser first and prints the actual reason rather than failing silently:

| What you see | What to do |
| --- | --- |
| "Camera access needs HTTPS" | The page is on `http://`. Use `localhost` or an https:// address |
| "permission was denied or blocked" | Allow the camera for the site in the browser's site settings, then reload |
| "viewing the app inside an embedded preview, which often blocks the camera" | Open the app in its own tab or on your phone; iframes need `allow="camera"` |
| "No camera was found" | No device is attached or enabled |
| "already in use by another app or tab" | Close the other camera app (Zoom, Teams, another tab) |
| Trial voids with `low-frame-rate` | The device is under 24 fps. Use the **faster model** link next to the preflight readout, close other tabs, or improve the lighting |

The preflight line under the video shows resolution, reported frame rate, whether the pose is found, and which body parts are missing from frame. A trial cannot be started until the shoulders, hips, knees, ankles and feet are all visible, because a trial without feet cannot be measured.

The MediaPipe WASM runtime is pinned to the installed `@mediapipe/tasks-vision` version at build time — a stale pin makes its CDN path 404 and the model never loads. Override the assets with `VITE_POSE_WASM_URL` / `VITE_POSE_MODEL_URL` if you vendor them locally.

---

## How the score works

Everything below lives in [`shared/scoring.js`](shared/scoring.js) as pure functions, with the parameters in [`shared/constants.js`](shared/constants.js). No model, no randomness.

1. **Measure.** One practice trial and three scored trials per leg, per test. Voided trials are never scored. The median of the valid scored trials is used, and at least three valid trials are required per leg.
2. **Score each test (0–100%).**
   - Single hop, crossover hop: `LSI = operated distance ÷ healthy distance × 100`, capped at 100.
   - Single-leg landing: `valgus score = (healthy valgus + 5°) ÷ (operated valgus + 5°) × 100`, the same with lateral trunk lean, then `landing quality = 0.70 × valgus + 0.30 × trunk`.
3. **Supporting observations.** Landing knee flexion and forward trunk lean from the side-view hop landings are shown to the therapist with an operated ÷ healthy ratio. They do not affect the status in v1.
4. **Criteria status — fixed rules only.**
   - *Meets target criteria*: every test score ≥ 90% and neither landing marker below 85%.
   - *Borderline*: any test score in the 85–90% band, or the session was flagged noisy.
   - *Below target criteria*: any test score < 85%, or either landing marker below its 85% floor. The responsible test or marker is named.
   - *Insufficient data*: too few valid trials or unreliable tracking.
5. **Trend score.** The average of the three test scores, drawn as a line across sessions. It never decides the status.

Parameters (target 90%, band 85–90%, marker floor 85%, weights 0.70/0.30, 5° buffer, 3 trials minimum, 6 attempts maximum, 2-hop crossover) are documented placeholders and still need clinician sign-off.

The spec's worked example is a test case: 156 cm vs 170 cm → **91.8%**, 410 cm vs 460 cm → **89.1%**, valgus 11° vs 4° and trunk 9° vs 6° → **62.9% landing quality**, status **below target criteria** naming the landing, trend **81.3%**. See [`tests/scoring.test.js`](tests/scoring.test.js).

---

## Architecture

```
.
├── index.html              Vite entry
├── src/                    React client (Router 7, one page per flow)
│   ├── lib/pose.js         MediaPipe Pose Landmarker setup + camera
│   ├── lib/measure.js      2D angle maths + hop / landing phase detectors
│   ├── lib/draft.js        in-progress check-in kept in localStorage
│   └── pages/              Welcome, auth, athlete flows, therapist flows
├── shared/                 imported by BOTH client and server
│   ├── constants.js        protocol parameters, labels, safety copy
│   ├── scoring.js          the scoring engine (pure, unit-tested)
│   ├── validation.js       trial validity vocabulary + payload validation
│   └── landmarks.js        12-point skeleton schema + encode/decode
├── server/                 Express 5 + node:sqlite
│   ├── db.js               schema + query helpers
│   ├── auth.js             bcrypt hashing, bearer sessions, roles
│   ├── access.js           athlete-controlled link enforcement
│   ├── gemini.js           explanations only
│   └── routes/             auth, links, assignments, sessions, athletes,
│                           exercises, plans, insights
├── tests/                  Vitest
└── docs/                   SPEC.md (requirements), PROTOCOL.md (measurement)
```

**Trust boundaries.** The browser does the pose tracking and trial capture. The server never trusts the client's summary: it re-validates the trials and recomputes every score, status and trend from the submitted measurements before storing anything. A therapist can only read an athlete's data while an active link exists, checked on every route.

**Video never leaves the device.** MediaPipe runs in the page on the camera stream. What is stored per trial is `{ metrics, valid, voidReasons, landmarks }`, where landmarks are 12 named points per frame rounded to four decimals (capped at 360 frames) — enough for the therapist's stick-figure replay.

**SQLite schema** (see [`server/db.js`](server/db.js)): `users`, `auth_sessions`, `link_codes`, `links`, `assignments`, `test_sessions`, `trials`, `trial_notes`, `decisions`, `exercises`, `plans`, `plan_items`, `plan_completions`. Deleting a user cascades to everything derived from them.

### API

Bearer token in `Authorization: Bearer <token>`. All routes are under `/api`.

| Method and path | Who | Purpose |
| --- | --- | --- |
| `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | any | Account and session |
| `PATCH /auth/me`, `DELETE /auth/me` | any | Profile (height, operated leg) and full data deletion |
| `GET /links/code`, `POST /links/code/rotate` | athlete | Invite code |
| `POST /links/redeem` | therapist | Link an athlete |
| `GET /links`, `DELETE /links/:id` | both | See or revoke links (athlete controls access) |
| `GET/POST/PATCH/DELETE /assignments` | therapist (athlete read-only) | Tests to run and check-in schedule |
| `POST /sessions` | athlete | Submit a check-in; scored server-side |
| `GET /sessions`, `GET /sessions/progress`, `GET /sessions/:id` | linked | History and trend |
| `DELETE /sessions/:id` | athlete | Delete one check-in |
| `POST /sessions/:id/notes`, `DELETE /sessions/:id/notes/:noteId` | therapist | Notes on a specific trial |
| `POST /sessions/:id/decision` | therapist | confirm / defer / re-test |
| `GET /athletes` | therapist | Patient list with latest status and trend |
| `GET/POST /exercises` | therapist | Library plus custom exercises |
| `GET/POST /plans`, `GET /plans/:id`, `POST /plans/:id/items/:itemId/complete` | role-aware | Plans and completion |
| `POST /insights/explain` | linked | Optional Gemini explanation (503 without a key) |
| `GET /health` | public | Liveness and whether Gemini is configured |

---

## Privacy and responsible use

- Video is processed in the browser and never uploaded or stored. Only derived measurements and landmark sequences are saved, visible to the athlete and their actively linked therapist, and deletable by either party (account deletion removes everything).
- The prototype uses volunteer or synthetic data. **It is not HIPAA-compliant**; compliance review is required before any use with real patients.
- The app assumes the athlete has been cleared for high-impact work by their therapist, shows a safety notice before every test, and never encourages pushing through pain.
- The 90% threshold is a commonly used benchmark, not a biological limit. 2D camera measurement is less accurate than lab equipment; the borderline band exists to reflect that.
- Gemini is used **only** to explain already-computed numbers or draft wording for the therapist. It never calculates a score, decides a criteria status or chooses exercises. Without `GEMINI_API_KEY` everything else works unchanged.

---

## Limitations

- **The camera path is software-verified, not clinically validated.** The pose model initialises and returns 33 landmarks, and a full trial runs end to end (take-off, landing, hold, distance, knee flexion) — checked in a real Chromium browser using a synthetic video source, because this development machine has no camera. A physical webcam, phone capture, lighting, and real athlete movement are still unverified, and the UI has not been walked through by hand.
- **Measurement calibration is a prototype.** Hop distance in centimetres uses the athlete's height (leg length ≈ 0.53 × height) and the standing hip-to-ankle length in pixels as a ruler. The LSI only uses a ratio between legs on the same fixed camera, so a fixed scale error cancels — but the centimetre values have not been validated against a tape measure yet. That validation (and repeated-test reliability) is required before clinical use.
- **2D pose only.** Frontal-plane valgus and lateral trunk lean are approximations from a single front view, and side-view knee flexion is an image-plane angle. No 3D reconstruction, no force plates.
- **Frame rate is the limiting factor.** The full pose model is the accurate default; on a device that cannot hold ~24 fps the preflight offers a faster model. Below 24 fps trials are voided rather than scored, which is correct but frustrating — hops are fast, so 60 fps capture is strongly preferred.
- **Phase detection is heuristic.** Landing-not-held and tracking-lost are detected in the browser; other-foot-touchdown and pausing-between-hops are best-effort and are there for the therapist to verify in the replay. Low frame rate (< 24 fps) voids the trial; 24–30 fps is recorded with a warning. Hops are fast, so 60 fps is strongly preferred.
- **The exercise library is demo content**, labelled as such, and must be replaced or verified against a clinic protocol before use. Exercises are always chosen by the therapist.
- **Not implemented yet:** PDF/CSV export, automated check-in reminders, multi-camera or 3D capture, native mobile apps, and any return-to-sport recommendation (which is deliberately out of scope).
- **Deployment:** SQLite is a single-file database, appropriate for a prototype on one host. `npm start` serves the built client and API together; a hosted Postgres is the documented later step.

---

## Testing

```bash
npm test
```

25 unit tests cover the medians, LSI and its cap, the 5° buffer maths, the 0.70/0.30 landing weights, every status rule (including the marker floor and the noisy flag), void-trial exclusion, insufficient-data handling, and the spec's full worked example. Measurement, phase-detection and camera code are not unit-tested; they need bench validation against a tape measure and real recordings.
