import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Disclaimer, ErrorBanner, SafetyNotice } from '../components/common.jsx';
import { LiveSkeletonCanvas } from '../components/SkeletonCanvas.jsx';
import { appendTrial, loadDraft, markPracticeDone, progressFor, saveDraft } from '../lib/draft.js';
import { useAuth } from '../lib/auth.jsx';
import { HopTrialDetector, LandingTrialDetector, hopDistanceCm, medianOf } from '../lib/measure.js';
import { compactLandmarks, encodeFrame } from '@shared/landmarks.js';
import {
  bodyInFrame,
  cameraInfo,
  cameraSupport,
  createFpsMeter,
  createPoseLandmarker,
  describeCameraError,
  namedPoints,
  startCamera,
  stopCamera,
} from '../lib/pose.js';
import { LEGS, PARAMS, SIDES, TESTS, TEST_META } from '@shared/constants.js';
import { isValidTrial } from '@shared/validation.js';

const TARGET_FPS = PARAMS.preferredFrameRate;

function sideForLeg(leg, operatedLeg) {
  const operatedSide = operatedLeg || SIDES.RIGHT;
  if (leg === LEGS.OPERATED) return operatedSide;
  return operatedSide === SIDES.LEFT ? SIDES.RIGHT : SIDES.LEFT;
}

function round1(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

export default function TestRunner() {
  const { test, leg } = useParams();
  const meta = TEST_META[test];
  const { user } = useAuth();

  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const detectorRef = useRef(null);
  const framesRef = useRef([]);
  const fpsMeterRef = useRef(createFpsMeter());
  const recordingRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const trialStartedAtRef = useRef(0);
  const lastOverlayRef = useRef(0);
  const startingRef = useRef(false);
  // The detection loop runs outside React, so it must call the *latest*
  // finalize function rather than the one captured when the loop started.
  const finalizeRef = useRef(null);

  const [draft, setDraft] = useState(() => loadDraft());
  const [phase, setPhase] = useState('intro'); // intro | starting | live | error
  const [error, setError] = useState(null);
  const [hint, setHint] = useState('Stand still with your whole body in frame.');
  const [fps, setFps] = useState(0);
  const [tracking, setTracking] = useState(false);
  const [points, setPoints] = useState(null);
  const [recording, setRecording] = useState(false);
  const [captured, setCaptured] = useState(null);
  const [camera, setCamera] = useState(null);
  const [model, setModel] = useState('full');
  const [switching, setSwitching] = useState(false);

  const side = useMemo(() => sideForLeg(leg, user?.operatedLeg), [leg, user?.operatedLeg]);
  const progress = draft ? progressFor(draft, test, leg) : null;
  const isLanding = test === TESTS.SINGLE_LEG_LANDING;
  const bodyCheck = useMemo(() => bodyInFrame(points), [points]);
  const canStart = phase === 'live' && !recording && bodyCheck.ok && !progress?.complete;

  const stopEverything = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    recordingRef.current = false;
    stopCamera(streamRef.current);
    streamRef.current = null;
    landmarkerRef.current?.close?.();
    landmarkerRef.current = null;
    setRecording(false);
    setTracking(false);
    setPoints(null);
    setFps(0);
    setCamera(null);
  }, []);

  useEffect(() => () => stopEverything(), [stopEverything]);

  const ensureLandmarker = async (which = model) => {
    if (!landmarkerRef.current) {
      landmarkerRef.current = await createPoseLandmarker({ model: which });
    }
    return landmarkerRef.current;
  };

  const finalizeTrial = useCallback(
    (rawResult, frames, startedAt) => {
      recordingRef.current = false;
      setRecording(false);

      const fpsNow = fpsMeterRef.current.lastFps || 0;
      const voidReasons = [...(rawResult.voidReasons || [])];
      if (rawResult.lostRatio > 0.15) voidReasons.push('tracking-lost');
      // Void only clearly unusable frame rates; between 24 and 30 fps we keep the
      // trial and warn, which is what the requirements ask for.
      if (fpsNow > 0 && fpsNow < 24) voidReasons.push('low-frame-rate');

      const video = videoRef.current;
      const aspect = video?.videoWidth && video?.videoHeight ? video.videoWidth / video.videoHeight : null;

      let metrics = {};
      if (isLanding) {
        metrics = {
          valgusDeg: round1(rawResult.peakValgusDeg),
          trunkLeanDeg: round1(rawResult.peakTrunkLeanDeg),
        };
        if (metrics.valgusDeg == null || metrics.trunkLeanDeg == null) voidReasons.push('no-landing-detected');
      } else {
        const distance = hopDistanceCm({
          takeoffX: rawResult.takeoffX,
          landingX: rawResult.landingX,
          aspect,
          standingDy: rawResult.standingHipAnkleDy,
          heightCm: user?.heightCm || 170,
        });
        metrics = {
          hopDistanceCm: distance,
          kneeFlexionDeg: round1(rawResult.landingKneeFlexionDeg),
          forwardTrunkLeanDeg: round1(Math.abs(rawResult.landingTrunkLeanDeg ?? NaN)),
        };
        if (distance == null) voidReasons.push('no-landing-detected');
      }

      const attemptedPractice = !progress?.practice;
      const trial = {
        test,
        leg,
        trialNo: (progress?.attempts || 0) + 1,
        valid: voidReasons.length === 0,
        voidReasons: [...new Set(voidReasons)],
        metrics,
        landmarks: compactLandmarks({ frames, fps: fpsNow || 30, aspect }),
        durationMs: Math.round(performance.now() - startedAt),
      };

      setCaptured({ ...trial, practice: attemptedPractice });

      const current = loadDraft();
      if (!current) return;
      const next = attemptedPractice ? markPracticeDone(current, test, leg) : appendTrial(current, trial);
      saveDraft(next);
      setDraft(next);
    },
    [isLanding, leg, progress?.attempts, progress?.practice, test, user?.heightCm],
  );

  // Keep the ref pointing at the newest closure without restarting the loop.
  useEffect(() => {
    finalizeRef.current = finalizeTrial;
  }, [finalizeTrial]);

  const startTrial = () => {
    if (!canStart) return;
    trialStartedAtRef.current = performance.now();
    detectorRef.current = isLanding
      ? new LandingTrialDetector({ side, fps: TARGET_FPS })
      : new HopTrialDetector({
          side,
          hops: test === TESTS.CROSSOVER_HOP ? PARAMS.crossoverHops : 1,
          fps: TARGET_FPS,
        });
    framesRef.current = [];
    recordingRef.current = true;
    lastVideoTimeRef.current = -1;
    fpsMeterRef.current.reset();
    setCaptured(null);
    setRecording(true);
    setHint(
      !progress?.practice
        ? 'Practice trial — this one is not scored.'
        : isLanding
          ? 'Step off the step when you are ready.'
          : 'Hop when you are ready.',
    );
  };

  /** Detection loop. Runs once per camera session; never restarted per trial. */
  const loop = useCallback(() => {
    const tick = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker) return;

      const now = performance.now();
      if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        const result = landmarker.detectForVideo(video, now);
        const named = namedPoints(result?.landmarks?.[0]);

        // React state drives the overlay; throttle it so drawing does not eat
        // the frame budget of the tracker.
        if (now - lastOverlayRef.current > 80) {
          lastOverlayRef.current = now;
          setPoints(named);
          setTracking(Boolean(named));
        }

        const measuredFps = fpsMeterRef.current.push(now);
        if (measuredFps > 0) setFps(Math.round(measuredFps));

        // Push every frame while recording, including lost ones, so the trial
        // can detect that tracking dropped out.
        if (recordingRef.current && detectorRef.current) {
          if (named) framesRef.current.push(encodeFrame(result.landmarks[0]));
          const update = detectorRef.current.push(named, now);
          if (update.hint) setHint(update.hint);
          if (update.done) {
            finalizeRef.current?.(update.result, framesRef.current, trialStartedAtRef.current);
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startSession = async () => {
    if (startingRef.current) return;
    const support = cameraSupport();
    if (!support.ok) {
      setPhase('error');
      setError(support.message);
      return;
    }

    startingRef.current = true;
    setPhase('starting');
    setError(null);
    setPoints(null);
    setTracking(false);

    try {
      await ensureLandmarker();
      const stream = await startCamera(videoRef.current, { frameRate: TARGET_FPS });
      streamRef.current = stream;
      setCamera(cameraInfo(stream, videoRef.current));
      setPhase('live');
      loop();
    } catch (problem) {
      console.error('[camera] start failed:', problem);
      setPhase('error');
      setError(describeCameraError(problem));
      stopEverything();
    } finally {
      startingRef.current = false;
    }
  };

  const retry = () => {
    stopEverything();
    startSession();
  };

  /**
   * Swap the pose model without touching the camera. The kilometre-scale cause
   * of "the camera is useless" on a weak device is frame rate, and the lite
   * model is several times faster than the full one.
   */
  const switchModel = async (next) => {
    if (recording || switching || next === model) return;
    setSwitching(true);
    setError(null);
    try {
      cancelAnimationFrame(rafRef.current);
      landmarkerRef.current?.close?.();
      landmarkerRef.current = null;
      const landmarker = await createPoseLandmarker({ model: next });
      landmarkerRef.current = landmarker;
      setModel(next);
      fpsMeterRef.current.reset();
      loop();
    } catch (problem) {
      setError(describeCameraError(problem));
    } finally {
      setSwitching(false);
    }
  };

  const stopAndReset = () => {
    stopEverything();
    setPhase('intro');
    setError(null);
  };

  if (!meta || ![TESTS.SINGLE_HOP, TESTS.CROSSOVER_HOP, TESTS.SINGLE_LEG_LANDING].includes(test)) {
    return (
      <div className="card">
        <h2>Unknown test</h2>
        <Link to="/athlete/check-in">Back to the check-in</Link>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="card stack">
        <h2>No check-in in progress</h2>
        <Link className="button" to="/athlete/check-in">
          Start a check-in
        </Link>
      </div>
    );
  }

  const validTrials = (draft.trials || []).filter(
    (trial) => trial.test === test && trial.leg === leg && isValidTrial(trial),
  );
  const lastDistances = validTrials.map((trial) => trial.metrics?.hopDistanceCm);
  const lowFps = fps > 0 && fps < PARAMS.minFrameRate;

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <span className="eyebrow">
            {leg === LEGS.OPERATED ? 'Operated leg' : 'Healthy leg'} · {meta.cameraView} view
          </span>
          <h1 style={{ marginBottom: '0.2rem' }}>{meta.label}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {meta.athleteBrief}
          </p>
        </div>
        <Link className="button ghost small" to="/athlete/check-in">
          Back
        </Link>
      </div>

      <ErrorBanner error={error} />

      <div className="runner-hud">
        <span>
          Trial <strong className="hud-value">{progress?.attempts || 0}</strong> of max {PARAMS.maxAttempts} ·{' '}
          <strong className="hud-value">{progress?.validCount || 0}</strong> valid ({PARAMS.minValidTrials} needed)
        </span>
        <span className={lowFps ? 'hud-warn' : ''}>
          {fps ? `${fps} fps` : 'fps —'}
          {lowFps ? ' · too low for reliable landing detection' : ''}
        </span>
        <span className={bodyCheck.ok ? '' : 'hud-warn'}>
          {bodyCheck.ok
            ? 'full body in frame'
            : points
              ? `not in frame: ${bodyCheck.missing.join(', ')}`
              : 'waiting for pose'}
        </span>
      </div>

      {progress?.practice === false && !recording && (
        <div className="notice">
          This first attempt is a practice trial. It is not scored, so you can get a feel for the movement.
        </div>
      )}

      <div
        className="camera-wrap"
        style={camera?.aspect ? { aspectRatio: String(camera.aspect) } : undefined}
      >
        <video ref={videoRef} autoPlay playsInline muted className={isLanding ? 'front-view' : ''} />
        <LiveSkeletonCanvas points={points} videoRef={videoRef} highlightSide={side} />
        {recording && <div className="hold-prompt">{hint}</div>}

        {phase === 'intro' && (
          <div className="camera-overlay">
            <div className="stack" style={{ maxWidth: 460 }}>
              <h3 style={{ margin: 0 }}>Camera placement</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {meta.cameraView === 'side'
                  ? 'Stand side-on to the camera so the whole body is visible, feet included. Keep the camera still for both legs.'
                  : 'Face the camera squarely so both hips, knees and feet are visible.'}
              </p>
              <button className="button" type="button" onClick={startSession}>
                Turn on camera and start
              </button>
            </div>
          </div>
        )}

        {phase === 'starting' && (
          <div className="camera-overlay">
            <div className="stack" style={{ maxWidth: 420 }}>
              <h3 style={{ margin: 0 }}>Starting the camera…</h3>
              <p className="muted small" style={{ margin: 0 }}>
                Allow camera access if your browser asks. The first load also downloads the pose model.
              </p>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="camera-overlay">
            <div className="stack" style={{ maxWidth: 480 }}>
              <h3 style={{ margin: 0 }}>The camera did not start</h3>
              <p className="small" style={{ margin: 0 }}>
                {error}
              </p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="button" type="button" onClick={retry}>
                  Try again
                </button>
                <Link className="button ghost" to="/athlete/check-in">
                  Back to check-in
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      {phase === 'live' && (
        <p className="preflight">
          <span className="ok">camera live</span>
          {camera ? (
            <span>
              {camera.width}×{camera.height}
              {camera.frameRate ? ` · ${camera.frameRate} fps reported` : ''} · {camera.label}
            </span>
          ) : null}
          <span className={bodyCheck.ok ? 'ok' : 'bad'}>
            {bodyCheck.ok ? 'full body in frame' : `step back — missing ${bodyCheck.missing.join(', ')}`}
          </span>
          <button
            type="button"
            className="link-button small"
            onClick={() => switchModel(model === 'full' ? 'lite' : 'full')}
            disabled={recording || switching}
          >
            {switching
              ? 'switching…'
              : model === 'full'
                ? 'slow device? use the faster model'
                : 'using fast model — switch back to accurate'}
          </button>
        </p>
      )}

      <div className="row between">
        <div className="row">
          <button className="button" type="button" onClick={startTrial} disabled={!canStart}>
            {progress?.practice === false ? 'Start practice trial' : 'Start trial'}
          </button>
          {phase === 'live' && (
            <button className="button ghost small" type="button" onClick={stopAndReset}>
              Stop camera
            </button>
          )}
          {progress?.complete && (
            <Link className="button secondary" to="/athlete/check-in">
              This leg is complete
            </Link>
          )}
        </div>
        {lastDistances.length > 0 && (
          <span className="muted small">
            valid trials: {lastDistances.filter(Number.isFinite).map((value) => `${value} cm`).join(', ')}
            {lastDistances.length > 0 && ` · median ${round1(medianOf(lastDistances))} cm`}
          </span>
        )}
      </div>

      {phase === 'live' && !bodyCheck.ok && !progress?.complete && (
        <p className="muted small" style={{ margin: 0 }}>
          {points
            ? 'A trial cannot start until the shoulders, hips, knees, ankles and feet are all visible. Step back until the far foot is in frame.'
            : 'Waiting for the pose model to find you. Stand fully in frame, in good light, facing the camera or side-on as instructed.'}
        </p>
      )}

      {captured && (
        <section className="card stack">
          <div className="row between">
            <h3 style={{ margin: 0 }}>
              {captured.practice ? 'Practice trial' : `Trial ${captured.trialNo}`} —{' '}
              {captured.valid ? 'valid' : 'voided'}
            </h3>
            {!captured.valid && <span className="badge status-below">not scored</span>}
          </div>
          {isLanding ? (
            <p style={{ margin: 0 }}>
              Peak knee valgus <span className="mono">{captured.metrics.valgusDeg ?? '—'}°</span> · peak lateral
              trunk lean <span className="mono">{captured.metrics.trunkLeanDeg ?? '—'}°</span>
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              Hop distance <span className="mono">{captured.metrics.hopDistanceCm ?? '—'} cm</span> · landing knee
              flexion <span className="mono">{captured.metrics.kneeFlexionDeg ?? '—'}°</span> · forward trunk lean{' '}
              <span className="mono">{captured.metrics.forwardTrunkLeanDeg ?? '—'}°</span>
            </p>
          )}
          {!captured.valid && (
            <p className="small hud-warn" style={{ margin: 0 }}>
              Voided trial — repeat it. {captured.voidReasons.join(', ')}
            </p>
          )}
          <div className="row">
            <button className="button" type="button" onClick={startTrial} disabled={!canStart}>
              {progress?.complete ? 'Leg complete' : 'Next trial'}
            </button>
            {progress?.complete && (
              <Link className="button ghost" to="/athlete/check-in">
                Back to check-in
              </Link>
            )}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Distance is estimated using your height and the standing hip-to-ankle length in this camera view. The
            LSI compares the two legs on the same setup, so a fixed scale error cancels out.
          </p>
        </section>
      )}

      <SafetyNotice />
      <Disclaimer />
    </div>
  );
}
