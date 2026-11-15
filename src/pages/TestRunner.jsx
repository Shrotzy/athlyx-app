import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Disclaimer, ErrorBanner, SafetyNotice } from '../components/common.jsx';
import { LiveSkeletonCanvas } from '../components/SkeletonCanvas.jsx';
import { appendTrial, loadDraft, markPracticeDone, progressFor, saveDraft } from '../lib/draft.js';
import { useAuth } from '../lib/auth.jsx';
import {
  HopTrialDetector,
  LandingTrialDetector,
  hopDistanceCm,
  medianOf,
} from '../lib/measure.js';
import { compactLandmarks, encodeFrame } from '@shared/landmarks.js';
import { createFpsMeter, createPoseLandmarker, namedPoints, startCamera, stopCamera } from '../lib/pose.js';
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
  const navigate = useNavigate();

  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const detectorRef = useRef(null);
  const framesRef = useRef([]);
  const fpsMeterRef = useRef(createFpsMeter());
  const recordingRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const pointsRef = useRef(null);
  const trialStartedAtRef = useRef(0);
  const lastOverlayRef = useRef(0);

  const [draft, setDraft] = useState(() => loadDraft());
  const [phase, setPhase] = useState('intro'); // intro | starting | live | error | finished
  const [error, setError] = useState(null);
  const [hint, setHint] = useState('Stand still with your whole body in frame.');
  const [fps, setFps] = useState(0);
  const [tracking, setTracking] = useState(true);
  const [points, setPoints] = useState(null);
  const [recording, setRecording] = useState(false);
  const [captured, setCaptured] = useState(null); // most recent trial result
  const [busy, setBusy] = useState(false);

  const side = useMemo(() => sideForLeg(leg, user?.operatedLeg), [leg, user?.operatedLeg]);
  const progress = draft ? progressFor(draft, test, leg) : null;
  const isLanding = test === TESTS.SINGLE_LEG_LANDING;

  const stopEverything = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    stopCamera(streamRef.current);
    streamRef.current = null;
    landmarkerRef.current?.close?.();
    landmarkerRef.current = null;
  }, []);

  useEffect(() => () => stopEverything(), [stopEverything]);

  const ensureLandmarker = async () => {
    if (!landmarkerRef.current) {
      landmarkerRef.current = await createPoseLandmarker();
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
          aspect: videoRef.current ? videoRef.current.videoWidth / videoRef.current.videoHeight : NaN,
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
        landmarks: compactLandmarks({ frames, fps: fpsNow || 30 }),
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

  const startTrial = () => {
    trialStartedAtRef.current = performance.now();
    const detector = isLanding
      ? new LandingTrialDetector({ side, fps: TARGET_FPS })
      : new HopTrialDetector({
          side,
          hops: test === TESTS.CROSSOVER_HOP ? PARAMS.crossoverHops : 1,
          fps: TARGET_FPS,
        });
    detectorRef.current = detector;
    framesRef.current = [];
    recordingRef.current = true;
    lastVideoTimeRef.current = -1;
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

  const loop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker) return;

    const tick = () => {
      if (!videoRef.current || !landmarkerRef.current) return;
      const now = performance.now();
      if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        const result = landmarkerRef.current.detectForVideo(video, now);
        const named = namedPoints(result?.landmarks?.[0]);
        pointsRef.current = named;
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
            finalizeTrial(update.result, framesRef.current, trialStartedAtRef.current);
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [finalizeTrial]);

  const startSession = async () => {
    setPhase('starting');
    setError(null);
    try {
      await ensureLandmarker();
      const stream = await startCamera(videoRef.current, { frameRate: TARGET_FPS });
      streamRef.current = stream;
      setPhase('live');
      loop();
    } catch (problem) {
      setPhase('error');
      setError(
        problem?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser, then try again.'
          : problem?.message || 'The camera or pose model could not start.',
      );
    }
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
        <span className={fps > 0 && fps < PARAMS.minFrameRate ? 'hud-warn' : ''}>
          {fps ? `${Math.round(fps)} fps` : 'fps —'}
          {fps > 0 && fps < PARAMS.minFrameRate ? ' · too low for reliable landing detection' : ''}
        </span>
        <span className={tracking ? '' : 'hud-warn'}>{tracking ? 'tracking' : 'no pose detected'}</span>
      </div>

      {progress?.practice === false && (
        <div className="notice">
          This first attempt is a practice trial. It is not scored, so you can get a feel for the movement.
        </div>
      )}

      <div className="camera-wrap">
        <video ref={videoRef} playsInline muted className={isLanding ? 'front-view' : ''} />
        <LiveSkeletonCanvas points={points} videoRef={videoRef} highlightSide={side} />
        {recording && <div className="hold-prompt">{hint}</div>}
        {phase === 'intro' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(3,7,15,0.92)',
              padding: '1.25rem',
              textAlign: 'center',
            }}
          >
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
      </div>

      <div className="row between">
        <div className="row">
          <button className="button" type="button" onClick={startTrial} disabled={phase !== 'live' || recording || progress?.complete}>
            {progress?.practice === false ? 'Start practice trial' : 'Start trial'}
          </button>
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
            <button
              className="button"
              type="button"
              onClick={startTrial}
              disabled={progress?.complete}
            >
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
