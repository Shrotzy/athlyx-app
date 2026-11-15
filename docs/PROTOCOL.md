# Measurement protocol

This is the measurement half of the requirements: what the athlete does, where the camera goes, what is measured, and what makes a trial void. The scoring half is [docs/SPEC.md](SPEC.md) section 2 and [`shared/scoring.js`](../shared/scoring.js).

The app measures. It does not coach, diagnose or clear anyone.

---

## Camera setup

| Test | View | Why |
| --- | --- | --- |
| Single hop for distance | Side | Hop distance is a horizontal displacement; landing knee flexion and forward trunk lean are read in the sagittal plane |
| Crossover hop (2 hops) | Side | Same, with the centre line crossing the camera |
| Single-leg landing | Front | Knee valgus and lateral trunk lean are frontal-plane markers |

Rules that apply to every test:

1. **One fixed camera position per test.** Hop distance is treated as a ratio between legs, so a constant scale error cancels — but only while the camera does not move. Moving the camera between legs or between sessions is the main way to create a fake asymmetry.
2. **Whole body in frame, feet included.** The foot landmarks (heel, toe) are what define take-off and landing.
3. **Stable, non-slip surface, clear runway.** Floor tape for the start line, plus a centre line for the crossover hop.
4. **60 fps where the device allows.** Hops and landings are fast. Below 24 fps the trial is voided; between 24 and 30 fps it is recorded with a warning.
5. **The athlete is cleared for high-impact work** by their physical therapist. The app repeats this before each test and reminds them to warm up and stop if there is pain.

The app asks for the operated leg once, in the athlete's account, and maps every measurement onto `operated` and `healthy` from there.

---

## Trials

- **1 practice + 3 scored trials per leg, per test.** The practice trial is discarded.
- Maximum **6 attempts** per leg per test. Attempts include voided trials, because the attempt count protects against retrying until a good number appears.
- The **median of the valid scored trials** is what gets scored, and **at least three valid trials** are required. Below that, the test is reported as insufficient data rather than scored on one lucky hop.
- Voided trials are never scored, and are never silently dropped: the therapist sees the void reason in the trial table.

### Void reasons

| Reason | Detection | Notes |
| --- | --- | --- |
| Landing not held | Automatic | The landing must stay still for `PARAMS.holdSeconds` |
| Tracking lost | Automatic | More than 15% of the trial's frames without the required landmarks |
| Frame rate too low | Automatic | Under 24 fps |
| No take-off detected | Automatic | The foot never left the baseline within the trial window |
| No landing detected | Automatic | No stable contact before the trial window closed |
| Other foot touched down | Best effort | Shown for the therapist to confirm in the replay |
| Paused between hops | Best effort | Same |

The last two are explicitly best-effort in the requirements: 2D pose from one camera cannot see every contact reliably, so the therapist verifies them in the skeleton replay.

---

## What each test measures

### Single hop for distance (side view)

- **Scored:** hop distance, toe position at take-off → heel position at the first stable landing.
- **Supporting:** landing knee flexion (hip–knee–ankle interior angle, reported as 180° − interior, so a straight leg is 0°) and forward trunk lean (torso from vertical in the sagittal plane).
- LSI = operated median ÷ healthy median × 100, capped at 100.

### Crossover hop, two continuous hops (side view)

- **Scored:** total distance, from the toe at the first take-off to the heel at the final stable landing. The take-off reference is frozen on the first hop so both hops count.
- **Supporting:** landing knee flexion at the final landing.
- This is an adaptation of the standard three-hop protocol, as stated in the requirements.

### Single-leg landing (front view)

- **Scored:** peak knee valgus and peak lateral trunk lean during the landing.
  - Valgus is the signed frontal-plane deviation of the knee from the hip→ankle line, positive toward the body midline (the inward collapse the test looks for).
  - Lateral trunk lean is the torso angle from vertical in the frontal plane.
- Peak values are taken from the drop until the landing is held.
- `valgus score = (healthy + 5) ÷ (operated + 5) × 100`; trunk score is the same formula; `landing quality = 0.70 × valgus + 0.30 × trunk`. Lower is better, so the operated leg is the denominator.

---

## Distance calibration (prototype)

Hop distance in centimetres uses the athlete's height:

```
leg length (cm)      ≈ 0.53 × height (cm)
cm per frame height  = leg length ÷ standing hip-to-ankle distance (fraction of frame height)
hop distance (cm)    = |landing x − take-off x| × (video width ÷ video height) × cm per frame height
```

Consequences worth stating plainly to a clinician:

- The **LSI is unaffected by a wrong scale** as long as the camera did not move, because both legs use the same ruler.
- The **centimetre numbers are estimates**, not tape-measure equivalents, until the bench validation below is done.
- If the athlete's height is not set, 170 cm is used and the numbers are approximate.

---

## Validation still required (before any clinical use)

1. **Tape-measure agreement**: hop distances from the app vs a tape measure, across repeat trials on the same person.
2. **Repeated-test reliability**: within-session and between-session variability, to calibrate the borderline band against real measurement noise.
3. **Valgus/trunk-lean agreement**: compared with a clinician's visual rating or a 3D system, at least on a small volunteer sample.
4. **Frame-rate sensitivity**: how measurement error grows as frame rate falls from 60 to 30 fps.
5. **Camera-movement check**: currently a manual instruction ("same setup as last time"), not an automated detection.

The prototype uses volunteer or synthetic data only, is not HIPAA-compliant, and needs compliance review before real patient use.
