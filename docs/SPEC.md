# ATHLYx — requirements

ATHLYx is a web app that uses a live camera to measure how symmetrically a recovering athlete's surgical and healthy legs perform three functional tests: a single hop for distance, a crossover hop and a single-leg landing. It gives their physical therapist test scores, a skeleton replay and exercise-plan tools. It is a movement-monitoring and decision-support aid, not a diagnosis or a return-to-sport clearance.

---

## 1. Overview

### Problem statement

Athletes recovering from lower-body surgery, such as ACL reconstruction or meniscus repair, risk reinjury if they return to sport before the surgical leg has regained symmetrical movement control. Lab-grade force plates and 3D motion-capture systems are too expensive for most clinics, and basic mobile angle apps only measure static knee bends. Between appointments, clinicians have little objective data, and compensations such as inward knee collapse or stiff landings often go unnoticed.

### Target users

- **Outpatient physical therapists and athletic trainers (primary):** clinicians who need an affordable, camera-only tool to quantify left-versus-right movement symmetry and monitor their athletes' progress between visits.
- **Recovering amateur and youth athletes:** everyday athletes (soccer, basketball, running) in mid-to-late-stage rehabilitation who use the app at home for regular check-ins and want objective feedback on how their surgical leg is moving, to share with their care team.

### Solution

The athlete performs three short functional tests in front of a live camera, on a schedule set by their physical therapist. The app tracks the body in real time in the browser, shows light live feedback and evaluates each test as soon as it is complete. Each test is done on both legs.

| Test | What the athlete does | Camera view | What the app measures |
| --- | --- | --- | --- |
| Single hop for distance | Hops forward as far as possible on one leg and holds the landing | Side | Hop distance (scored). Landing knee flexion and forward trunk lean (shown to the therapist) |
| Crossover hop (2 continuous hops) | Hops forward twice on one leg, crossing a center line each time, and holds the final landing | Side | Total hop distance (scored). Landing knee flexion (shown to the therapist) |
| Single-leg landing | Steps down from a low step onto one leg and holds the landing | Front | Dynamic knee valgus and lateral trunk lean (scored) |

The results go to the therapist, who can review the scores, watch a skeleton replay of every trial (an animated stick figure rebuilt from tracked landmarks, with no stored video), add notes to specific trials and send the athlete an exercise plan. The therapist always makes the clinical decisions. The app measures and informs.

### Goals

- Measure hop distance and landing mechanics for each leg from a standard camera, without wearables or lab hardware.
- Turn those measurements into transparent, explainable test scores and a threshold-based status for the clinician.
- Let therapists monitor progress between appointments and respond with an exercise plan.
- Keep all video on the user's device and store only derived measurements and landmark data.

### User scenario

Maya is eight months out from ACL reconstruction. Her physical therapist has cleared her for hop testing and assigned a check-in. She props her phone at her marked spot in side view and selects her right knee as the operated leg. After a warm-up, she does a practice hop and three scored single hops on each leg, then the two-hop crossover hop. The app measures each distance and tells her when a trial is voided. She then moves the phone to the front for single-leg landings.

Her hop distances are close between legs, but her right knee collapses inward more on landing. Her therapist watches the skeleton replay, adds a note to the third landing trial and sends a short exercise plan with a message. Maya completes the plan over the next few days and repeats the check-in, and the therapist watches the trend across sessions.

### Scope for this version

**In scope:** a web app with live camera tracking; three tests (single hop for distance, two-hop crossover hop, single-leg landing) on both legs; trial validity checks; LSI per hop test; landing mechanics measurement; criteria status for the therapist; scheduled check-ins; therapist review with skeleton replay and trial notes; exercise plans; history.

**Out of scope:** diagnosis, medical clearance or return-to-sport decisions, strength testing, timed hop tests, triple hop, patient-reported questionnaires, 3D reconstruction, multi-camera setups, native mobile apps, stored video, real patient data.

### Limitations and responsible use

- The tool is a monitoring and decision-support aid. It does not diagnose and does not clear anyone to return to sport. Hop and landing tests are one part of a broader assessment, and the decision belongs to the athlete's surgeon and physical therapist.
- Distance symmetry can look normal while landing mechanics are not. Neither replaces strength testing, psychological readiness assessment and clinical judgment.
- Camera-based 2D pose estimation is less accurate than lab equipment, so small differences may fall within measurement noise. The design reduces this by comparing each athlete against their own healthy leg, using several trials and providing a borderline status.
- Hop distance is measured from a 2D camera view, so accuracy depends on a fixed camera position and the frame rate.
- Valgus and lateral trunk lean are measured from the front view in the landing test, while hop distance, landing knee flexion and forward trunk lean are measured from the side view in the hop tests. The protocol fixes the camera position for each test.
- The two-hop crossover hop is an adaptation of the standard three-hop protocol.
- The 90% threshold is a commonly used benchmark and not a biological limit.
- Video is processed in the browser and is never uploaded or stored. Only derived measurements and landmark data are saved, and they are visible only to the athlete and their linked therapist.
- The prototype is demonstrated with volunteer or synthetic data. It is not HIPAA-compliant, and compliance review is required before any use with real patients.

---

## 2. How the movement symmetry score works

The score is based on the **Limb Symmetry Index (LSI)**, which expresses the operated leg's result as a percentage of the healthy leg's result, where 100% means equal performance. A threshold of about 90% is commonly used in return-to-sport criteria for hop tests. ATHLYx applies it to hop distance directly and adds landing-mechanics scores that distance alone cannot show.

### Step 1: Measure

Each leg completes one practice trial and three scored trials per test. Trials are voided if the athlete touches down with the other foot, pauses between hops, cannot hold the landing or if tracking is lost. For each test and leg, take the median of the valid scored trials (at least three valid trials are needed).

### Step 2: Test scores (0–100%)

Each score is capped at 100%.

- **Single hop and crossover hop:** LSI = operated-leg distance ÷ healthy-leg distance × 100.
- **Single-leg landing:** a landing quality score from two markers, both measured from the front view and both lower-is-better:
  - Valgus score = (healthy valgus + 5°) ÷ (operated valgus + 5°) × 100
  - Trunk score = (healthy lateral trunk lean + 5°) ÷ (operated lateral trunk lean + 5°) × 100
  - Landing quality = 0.70 × Valgus score + 0.30 × Trunk score
  - The 5° buffer avoids division by zero when alignment is near perfect.

### Step 3: Supporting observations

Landing knee flexion and forward trunk lean from the side-view hop landings are recorded and shown to the therapist, with a flexion ratio (operated ÷ healthy × 100). They are not part of the status rules in version 1.

### Step 4: Criteria status for the therapist

The status comes only from fixed rules, never from an AI model.

| Status | Rule |
| --- | --- |
| Meets target criteria | Every test score is at or above 90%, and neither landing marker score is below its floor |
| Borderline | Any test score is between 85% and 90%, or the measurements are too noisy to be sure. A re-test is suggested |
| Below target criteria | Any test score is below 85%, or either landing marker score is below its floor. The responsible test or marker is named |
| Insufficient data | Too few valid trials or unreliable tracking |

A single trend score (the average of the three test scores) is shown only as a line across sessions. It never decides the status.

### Example

An athlete 6 months after ACL surgery:

- Single hop: 156 cm (operated) vs 170 cm (healthy) gives an LSI of 91.8%.
- Crossover hop: 410 cm vs 460 cm total gives an LSI of 89.1%.
- Landing: valgus 11° vs 4° gives a valgus score of 56.3%, and trunk lean 9° vs 6° gives a trunk score of 78.6%. Landing quality = 0.70 × 56.3 + 0.30 × 78.6, which is about 63%.
- Supporting information: landing knee flexion 65° vs 75° (ratio 86.7%).
- Status: **Below target criteria**, naming the landing (inward knee collapse). The crossover hop is also in the borderline band. The hop distances alone would have looked close to passing.
- Trend score: (91.8 + 89.1 + 63.0) ÷ 3, about 81.3%.

### Parameters (placeholder values to tune with clinician input)

| Parameter | Value |
| --- | --- |
| Target score per test | 90% |
| Borderline band | 85% up to 90% |
| Landing marker floor (valgus score, trunk score) | 85% |
| Landing weights (valgus / trunk) | 0.70 / 0.30 |
| Buffer for lower-is-better markers | 5° |
| Trials per leg per test | 1 practice + 3 scored |
| Minimum valid scored trials per leg | 3 |
| Maximum attempts per leg per test | 6 |
| Crossover hop | 2 continuous hops (adapted from the standard 3) |
| Trend score | Average of the three test scores |

---

## 3. Stacks

### Development

- Node.js (current LTS version) and npm
- Git and a shared GitHub repo, with small, frequent commits
- Coder cloud workspaces (Tech Stack Builder template) as the shared development environment
- A code editor (VS Code, or Cursor for the Cursor challenge)
- Chrome or Edge for desktop testing, plus Chrome (Android) and Safari (iOS) for mobile testing
- A unit-testing tool such as Vitest or Jest for the measurement and scoring math

### Frontend

- Vite with React and React Router
- @mediapipe/tasks-vision (the MediaPipe Pose Landmarker package), running live in the browser
- HTML canvas for the live skeleton overlay, on-screen readouts and skeleton replay
- A charting library such as Chart.js or Recharts for progress graphs
- Optional: a PDF export library for clinician reports

### Backend

- Express (Node) with cors and dotenv
- Authentication with password hashing (for example bcrypt) and session tokens, with roles for athlete and physical therapist
- Google's Gemini SDK for JavaScript, used only to explain results in plain language or draft wording for the therapist to edit, never to decide the criteria status or choose exercises

### Database

- SQLite for sessions and progress over time (a hosted Postgres is a later option)
- Stored data: per-trial measurements (hop distances and landing markers), medians, test scores, criteria status, compact landmark sequences for skeleton replay, test assignments and schedules, therapist notes and decisions, exercises and exercise plans with completion records
- Never stored: video or images

### Accounts and keys

- Gemini API key (from Google AI Studio)
- Vultr account (free credits) for hosting
- GoDaddy Registry domain

### Hardware

- A laptop with a webcam is enough for development. A GPU is not needed.
- For real use: a phone or laptop on a stable stand, ideally recording at 60 frames per second, since hops and landings are fast.
- Floor tape for a start line and a center line (crossover hop), plus a clear, non-slip surface with room for the longest hop.
- Two camera positions: side view for the hop tests and front view for the landing test, with the camera kept fixed between legs.

---

## 4. Software requirements

### Functional requirements

#### Accounts and assignment

1. Users sign up and log in as an athlete or a physical therapist.
2. An athlete links to a therapist through an invite code and can revoke access at any time.
3. The therapist assigns which tests to run (single hop for distance, crossover hop, single-leg landing) and sets the check-in schedule.
4. Before a hop or landing test, the athlete sees a notice to proceed only if their therapist has cleared them for high-impact work. The notice includes a reminder to warm up, use a clear non-slip surface and stop if there is pain.

#### Setup

1. Access the webcam or phone camera with permission and run each test as a live camera feed.
2. Guide the user through setup: choose the operated leg, follow a camera placement guide (side view for hop tests, front view for the landing test), mark a start line and center line on the floor, and check that the full body, including the feet, is in frame.
3. Check that the camera stays fixed between legs and between tests, and prompt "same setup as last time" for consistent comparisons.

#### Live monitoring

1. Detect the body continuously and show a live skeleton overlay with the legs highlighted.
2. Guide the athlete through each test on each leg: one practice trial and three scored trials, with a trial counter.
3. Show light live feedback (skeleton, tracking confidence, trial count, "hold your landing" prompts). The app monitors and does not coach.
4. Detect trial phases (takeoff, flight, landing, hold) automatically.
5. Void invalid trials and prompt a repeat. Landing not held and tracking lost are detected reliably. Other foot touching down and pausing between hops are detected on a best-effort basis, and the therapist can check them in the replay. Voided trials are never scored.

#### Measurement

1. For the hop tests, measure hop distance from the toe position at takeoff to the heel position at first stable landing, as a ratio between legs. For the crossover hop, record the total distance of two continuous hops.
2. For the single-leg landing, measure peak knee valgus and peak lateral trunk lean from the front view.
3. For the hop tests, record landing knee flexion and forward trunk lean from the side view as supporting information for the therapist.

#### Evaluation

1. For each test and leg, take the median of the valid scored trials (at least three needed).
2. Calculate the LSI for each hop test (operated ÷ healthy × 100, capped at 100%) and the landing quality score for the single-leg landing.
3. Determine the criteria status from fixed rules only, never from an AI model: meets target criteria, borderline, below target criteria or insufficient data, using the rules and parameters in section 2.
4. Describe results as the current state of movement symmetry and its change over time, never as healing progress or return-to-sport clearance.

#### Physical therapist review

1. Show a patient list with each athlete's latest status and trend.
2. Show each session's per-test scores, trial values, supporting observations and criteria status, with a note that this is one set of tests.
3. Provide skeleton replay: an animated stick-figure playback of each trial, rebuilt from stored landmark data, with measured values overlaid. No video is stored.
4. Let the therapist attach notes to individual trials.
5. Let the therapist record a decision and note for each session (confirm, defer or re-test).

#### Exercise plans

1. Let the therapist build a plan from an exercise library or their own custom exercises, with sets, reps, instructions, a personal message and a safety notice (stop if there is pain and contact your therapist).
2. Provide a small default library based on published recommendations from health and athletics organizations, with the source and a stage note shown for each exercise. Therapist-created exercises are labelled as such.
3. Let the athlete view their plan and mark exercises as completed, and let the therapist see completion status before the next check-in.
4. Exercises are chosen by the therapist, never by AI.

#### Athlete results, history and reporting

1. Show the athlete a session summary with per-test scores and a neutral message that their therapist will review the results. The criteria status and flags are shown to the therapist only.
2. Save each session and show history and progress over time, including the trend score.
3. Show a disclaimer before each test and with every result: the app is a movement-monitoring and decision-support aid for the care team, it does not diagnose, and it is not a return-to-sport clearance.
4. Optional: generate a plain-language explanation of the numbers through the Gemini API (explaining only, never calculating or deciding), and export a PDF or CSV report for the therapist.
5. Allow users to delete their data.

### Non-functional requirements

1. **Real-time performance:** live tracking at 30 frames per second or more, and 60 frames per second where the device allows, because hops and landings are fast. The app warns when the frame rate is too low for reliable landing detection.
2. **Privacy:** video is processed in the browser and never uploaded or stored. Only derived measurements and landmark data are saved, visible only to the athlete and their linked therapist, sent over HTTPS and deletable on request.
3. **Prototype data policy:** the demo uses volunteer or synthetic data only. The prototype is not HIPAA-compliant, and compliance review is future work before any real patient use.
4. **Usability:** a check-in is clear and quick to start, with on-screen instructions, a placement guide and hands-free steps. A therapist can review a session quickly.
5. **Reliability:** lost tracking prompts the user to step back into frame without crashing. Unreliable trials are voided instead of scored. If the server or Gemini is unavailable, the live tests and on-device evaluation still work, and the user is told that results were not saved.
6. **Compatibility:** a responsive web app that works on a laptop webcam in Chrome or Edge and on mobile browsers (Chrome on Android, Safari on iOS).
7. **Measurement consistency:** hop distance is a ratio between legs, so a fixed camera scale cancels out as long as the camera does not move. The app checks for camera movement between legs and tests.
8. **Measurement quality:** documented accuracy limits of 2D camera measurement, validated against a tape measure and repeated tests on the same person. The borderline status reflects this uncertainty.
9. **Explainability:** every score and status can be traced to the measured values, and skeleton replay lets the therapist verify what the camera saw.
10. **Safety and scope:** the tool is not a medical device, diagnosis or return-to-play decision. The final decision rests with the clinician. Hop and landing tests are high-impact, so the app assumes therapist clearance and never encourages pushing through pain.
11. **Access control:** a therapist sees an athlete's data only through an active link that the athlete controls, enforced on the server.
