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
  handsRaised,
  namedPoints,
  startCamera,
  stopCamera,
} from '../lib/pose.js';
import { bestGesture, closeGestureRecognizer, createGestureRecognizer } from '../lib/gesture.js';
import { createGestureGate, createHoldGate } from '../lib/gesture-gate.js';
import {
  CUES,
  cancelSpeech,
  chime,
  setVoiceMuted,
  speak,
  unlockVoice,
  voiceDiagnostics,
  voiceMuted,
  voiceSupported,
} from '../lib/voice.js';
import { commandSupport, createVoiceCommands } from '../lib/voice-commands.js';
import { LEGS, PARAMS, SIDES, TESTS, TEST_META } from '@shared/constants.js';
import { isValidTrial } from '@shared/validation.js';

const TARGET_FPS = PARAMS.preferredFrameRate;

/** Seconds between trials: long enough to walk back to the start line. */
const REST_SECONDS = 6;

/** How often the hand-gesture model runs while it is waiting for a gesture. */
const GESTURE_CHECK_MS = 140;

const VOICE_COMMANDS_KEY = 'athlyx.voicecommands';
const SIGNAL_KEY = 'athlyx.signal';

/**
 * How a trial starts.
 *
 * `auto` needs no signal at all: a spoken countdown runs and the trial starts
 * itself. `hand` is a hand above the shoulder, read from the pose model that is
 * already running. `thumb` uses the separate gesture model.
 *
 * `auto` is the default on purpose: it is the only one that cannot fail because
 * of the lighting, the distance from the camera, or a heavy accent.
 */
const SIGNAL_MODES = [
  ['auto', '⏱ automatic'],
  ['hand', '✋ raise a hand'],
  ['thumb', '👍 thumbs up'],
];

const SIGNAL_DETAIL = {
  auto: 'Starts automatically',
  hand: 'Raise a hand to start',
  thumb: 'Thumbs up or open palm to start',
};

const SIGNAL_STATUS = {
  auto: 'Automatic: a spoken 3-2-1 starts each trial. Nothing to press, nothing to learn.',
  hand: 'Raise either hand above your shoulder for half a second to start a trial.',
  thumb: 'Hold a thumbs up or an open palm for half a second. Needs the separate hand model.',
};

function readFlag(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (value == null) return fallback;
    return value === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private mode */
  }
}

function readSignal() {
  try {
    const stored = localStorage.getItem(SIGNAL_KEY);
    return ['auto', 'hand', 'thumb'].includes(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

function sideForLeg(leg, operatedLeg) {
  const operatedSide = operatedLeg || SIDES.RIGHT;
  if (leg === LEGS.OPERATED) return operatedSide;
  return operatedSide === SIDES.LEFT ? SIDES.RIGHT : SIDES.LEFT;
}

function round1(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

/** What the athlete should read from three metres away while a trial runs. */
function bigCueFor(phaseName, isLanding) {
  switch (phaseName) {
    case 'calibrating':
      return 'STAND STILL';
    case 'grounded':
    case 'ready':
      return isLanding ? 'STEP DOWN' : 'HOP WHEN READY';
    case 'landed':
    case 'landing':
      return 'HOLD IT';
    case 'searching':
      return 'STEP INTO FRAME';
    default:
      return null;
  }
}

export default function TestRunner() {
  const { test, leg } = useParams();
  const meta = TEST_META[test];
  const { user } = useAuth();

  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const gestureRef = useRef(null);
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
  const startTrialRef = useRef(null);
  const bodyCheckRef = useRef({ ok: false, missing: [] });
  const readyRef = useRef(false);
  const gateRef = useRef(createGestureGate({ holdMs: 450, minScore: 0.5 }));
  const handGateRef = useRef(createHoldGate());
  const signalRef = useRef('auto');
  const lastGestureAtRef = useRef(0);
  const restTimerRef = useRef(0);
  const autoTimerRef = useRef(0);
  const autoStartedRef = useRef(false);
  const voiceCommandsRef = useRef(null);
  const spokenHoldRef = useRef(false);
  const lastCuePhaseRef = useRef(null);

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

  // Hands-free / audio layer
  const [ready, setReady] = useState(false);
  const [restLeft, setRestLeft] = useState(0);
  const [cue, setCue] = useState(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [gestureStatus, setGestureStatus] = useState('off'); // off | loading | ready | unavailable
  const [voiceOn, setVoiceOn] = useState(() => !voiceMuted() && voiceSupported());
  const [signal, setSignal] = useState(readSignal);
  const [voiceCommandsOn, setVoiceCommandsOn] = useState(() => readFlag(VOICE_COMMANDS_KEY, false));
  const [listenStatus, setListenStatus] = useState('off'); // off | listening | blocked | unsupported
  const voiceCommandSupport = useMemo(() => commandSupport(), []);

  const side = useMemo(() => sideForLeg(leg, user?.operatedLeg), [leg, user?.operatedLeg]);
  const progress = draft ? progressFor(draft, test, leg) : null;
  const isLanding = test === TESTS.SINGLE_LEG_LANDING;
  const bodyCheck = useMemo(() => bodyInFrame(points), [points]);
  const audio = voiceDiagnostics();

  useEffect(() => {
    bodyCheckRef.current = bodyCheck;
  }, [bodyCheck]);

  useEffect(() => {
    signalRef.current = signal;
  }, [signal]);

  /** Arm or disarm the "waiting for the athlete's signal" state. */
  const arm = useCallback((value) => {
    readyRef.current = value;
    setReady(value);
    if (!value) setHoldProgress(0);
  }, []);

  const clearRest = useCallback(() => {
    if (restTimerRef.current) {
      clearInterval(restTimerRef.current);
      restTimerRef.current = 0;
    }
    setRestLeft(0);
  }, []);

  const stopEverything = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    recordingRef.current = false;
    clearInterval(restTimerRef.current);
    restTimerRef.current = 0;
    clearTimeout(autoTimerRef.current);
    autoTimerRef.current = 0;
    autoStartedRef.current = false;
    stopCamera(streamRef.current);
    streamRef.current = null;
    landmarkerRef.current?.close?.();
    landmarkerRef.current = null;
    closeGestureRecognizer(gestureRef.current);
    gestureRef.current = null;
    cancelSpeech();
    gateRef.current.reset();
    handGateRef.current.reset();
    readyRef.current = false;
    setReady(false);
    setRestLeft(0);
    setHoldProgress(0);
    setGestureStatus('off');
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

  const ensureGestures = useCallback(async () => {
    if (gestureRef.current) return gestureRef.current;
    setGestureStatus('loading');
    try {
      const recognizer = await createGestureRecognizer();
      gestureRef.current = recognizer;
      setGestureStatus('ready');
      return recognizer;
    } catch (problem) {
      console.warn('[gesture] could not load the gesture model:', problem?.message || problem);
      setGestureStatus('unavailable');
      return null;
    }
  }, []);

  /**
   * After a trial: say what happened, rest, then either start the next trial on
   * its own (automatic mode) or wait for the athlete's signal. Nothing is
   * clicked either way.
   */
  const scheduleNext = useCallback(
    ({ complete, spoken }) => {
      arm(false);
      clearRest();

      if (complete) {
        setCue({ text: 'LEG COMPLETE', detail: 'Stop the camera or move on to the next test', tone: 'good' });
        speak(`${spoken || ''} ${CUES.legComplete}`.trim());
        return;
      }

      setCue({
        text: 'REST',
        detail: signalRef.current === 'auto' ? 'The next trial starts by itself' : 'Get back to the start line',
        tone: 'info',
      });
      speak(`${spoken || ''} ${CUES.rest(REST_SECONDS)}`.trim());

      let left = REST_SECONDS;
      setRestLeft(left);
      restTimerRef.current = setInterval(() => {
        left -= 1;
        setRestLeft(Math.max(0, left));

        if (left > 0) {
          // Spoken countdown over the last three seconds.
          if (left <= 3) {
            speak(String(left), { rate: 1.15 });
            chime('tick');
          }
          return;
        }

        clearInterval(restTimerRef.current);
        restTimerRef.current = 0;
        setRestLeft(0);
        gateRef.current.reset();
        handGateRef.current.reset();
        lastGestureAtRef.current = 0;

        if (signalRef.current === 'auto') {
          setCue({ text: 'GO', detail: 'Trial started', tone: 'good' });
          chime('go');
          speak('Go.');
          startTrialRef.current?.();
          return;
        }

        arm(true);
        setCue({ text: 'READY', detail: SIGNAL_DETAIL[signalRef.current], tone: 'info' });
        chime('ready');
        speak(CUES.hopReady);
      }, 1000);
    },
    [arm, clearRest],
  );

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

      let nextProgress = null;
      const current = loadDraft();
      if (current) {
        const next = attemptedPractice ? markPracticeDone(current, test, leg) : appendTrial(current, trial);
        saveDraft(next);
        setDraft(next);
        nextProgress = progressFor(next, test, leg);
      }

      let spoken;
      if (attemptedPractice) {
        spoken = 'Practice trial saved.';
      } else if (!trial.valid) {
        spoken = CUES.trialVoided;
      } else if (isLanding) {
        spoken = CUES.landingSaved;
      } else {
        spoken = CUES.trialSaved(metrics.hopDistanceCm);
      }

      scheduleNext({ complete: Boolean(nextProgress?.complete), spoken });
    },
    [isLanding, leg, progress?.attempts, progress?.practice, scheduleNext, test, user?.heightCm],
  );

  // Keep the ref pointing at the newest closure without restarting the loop.
  useEffect(() => {
    finalizeRef.current = finalizeTrial;
  }, [finalizeTrial]);

  const startTrial = () => {
    if (recordingRef.current) return;
    if (phase !== 'live' || progress?.complete) return;

    if (!bodyCheckRef.current.ok) {
      speak(CUES.stepBack);
      setCue({
        text: 'STEP BACK',
        detail: `Not in frame: ${bodyCheckRef.current.missing.join(', ')}`,
        tone: 'warn',
      });
      return;
    }

    clearTimeout(autoTimerRef.current);
    autoTimerRef.current = 0;
    clearRest();
    arm(false);
    gateRef.current.reset();
    handGateRef.current.reset();
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
    lastCuePhaseRef.current = null;
    spokenHoldRef.current = false;
    fpsMeterRef.current.reset();
    setCaptured(null);
    setRecording(true);

    const startText = isLanding ? CUES.stepStart : CUES.hopStart;
    setHint(!progress?.practice ? 'Practice trial — this one is not scored.' : startText);
    setCue({
      text: isLanding ? 'STEP DOWN' : 'HOP WHEN READY',
      detail: !progress?.practice ? 'Practice trial — not scored' : 'Stand still, then go',
      tone: 'info',
    });
    speak(progress?.practice === false ? `${CUES.practiceIntro} ${startText}` : startText);
  };

  useEffect(() => {
    startTrialRef.current = startTrial;
  });

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

        // Waiting for the athlete's start signal.
        if (!recordingRef.current && readyRef.current) {
          if (signalRef.current === 'hand') {
            const verdict = handGateRef.current.update(handsRaised(named).any, now);
            setHoldProgress(verdict.progress);
            if (verdict.fired) {
              arm(false);
              startTrialRef.current?.();
            }
          } else if (signalRef.current === 'thumb' && gestureRef.current) {
            if (now - lastGestureAtRef.current > GESTURE_CHECK_MS) {
              lastGestureAtRef.current = now;
              try {
                const found = bestGesture(gestureRef.current.recognizeForVideo(video, now));
                const verdict = gateRef.current.update(found?.name ?? null, found?.score ?? 0, now);
                setHoldProgress(verdict.progress);
                if (verdict.fired) {
                  arm(false);
                  startTrialRef.current?.();
                }
              } catch (gestureError) {
                console.warn('[gesture] recognition failed:', gestureError?.message || gestureError);
              }
            }
          }
        }

        // Push every frame while recording, including lost ones, so the trial
        // can detect that tracking dropped out.
        if (recordingRef.current && detectorRef.current) {
          if (named) framesRef.current.push(encodeFrame(result.landmarks[0]));
          const update = detectorRef.current.push(named, now);
          if (update.hint) setHint(update.hint);

          const nextPhase = update.phase;
          if (nextPhase !== lastCuePhaseRef.current) {
            lastCuePhaseRef.current = nextPhase;
            const big = bigCueFor(nextPhase, isLanding);
            if (big) {
              setCue({
                text: big,
                detail: null,
                tone: nextPhase === 'landed' || nextPhase === 'landing' ? 'good' : 'info',
              });
            }
            if (nextPhase === 'landed' || nextPhase === 'landing') {
              if (!spokenHoldRef.current) {
                spokenHoldRef.current = true;
                speak(CUES.holdIt);
              }
            }
          }

          if (update.done) {
            finalizeRef.current?.(update.result, framesRef.current, trialStartedAtRef.current);
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [arm, isLanding]);

  /**
   * Automatic mode: once the athlete is fully in frame, count down out loud and
   * start the first trial. Later trials are handled by scheduleNext.
   */
  useEffect(() => {
    if (phase !== 'live' || signal !== 'auto' || recording || progress?.complete) return;
    if (autoStartedRef.current || readyRef.current) return;
    if (!bodyCheck.ok) return;
    autoStartedRef.current = true;

    let count = 3;
    const tick = () => {
      if (recordingRef.current) return;
      if (count === 0) {
        arm(false);
        setCue({ text: 'GO', detail: 'Trial started', tone: 'good' });
        chime('go');
        speak('Go.');
        startTrialRef.current?.();
        return;
      }
      setCue({ text: String(count), detail: 'Starting automatically — stand still', tone: 'info' });
      speak(String(count), { rate: 1.15 });
      chime('tick');
      count -= 1;
      autoTimerRef.current = setTimeout(tick, 1000);
    };
    autoTimerRef.current = setTimeout(tick, 1200);
  }, [phase, signal, recording, progress?.complete, bodyCheck.ok, arm]);

  const startSession = async () => {
    if (startingRef.current) return;
    const support = cameraSupport();
    if (!support.ok) {
      setPhase('error');
      setError(support.message);
      return;
    }

    // Speech needs a user gesture in some browsers; this click is one.
    unlockVoice();

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
      autoStartedRef.current = false;
      loop();
      setCue({ text: 'READY', detail: SIGNAL_DETAIL[signal], tone: 'info' });
      speak('Camera on. Stand still with your whole body in frame.');
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
    setCue(null);
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceMuted(!next);
    if (next) {
      unlockVoice();
      speak('Sound on.');
      chime('ready');
    }
  };

  /** Lets the athlete (or the demo audience) hear exactly what the cues sound like. */
  const testSound = () => {
    unlockVoice();
    chime('ready');
    speak('Sound check. Three, two, one.');
  };

  const chooseSignal = (next) => {
    setSignal(next);
    try {
      localStorage.setItem(SIGNAL_KEY, next);
    } catch {
      /* private mode */
    }
    gestureRef.current?.close?.();
    gestureRef.current = null;
    setGestureStatus('off');
    gateRef.current.reset();
    handGateRef.current.reset();
    setHoldProgress(0);
    autoStartedRef.current = false;

    speak(
      next === 'auto'
        ? 'Automatic start.'
        : next === 'hand'
          ? 'Raise a hand to start.'
          : 'Thumbs up to start.',
    );
    setCue({ text: 'READY', detail: SIGNAL_DETAIL[next], tone: 'info' });

    if (phase === 'live') {
      if (next === 'auto') {
        arm(false);
      } else {
        arm(true);
      }
      if (next === 'thumb') ensureGestures();
    }
  };

  const toggleVoiceCommands = () => {
    const next = !voiceCommandsOn;
    setVoiceCommandsOn(next);
    writeFlag(VOICE_COMMANDS_KEY, next);
    if (next) speak('Voice commands on. Say ready to start a trial.');
  };

  // The separate hand model is only downloaded when thumbs-up is the chosen signal.
  useEffect(() => {
    if (phase !== 'live' || signal !== 'thumb') return;
    ensureGestures();
  }, [phase, signal, ensureGestures]);

  // Voice commands are opt-in: enabling them is what triggers the microphone
  // prompt, so nobody is asked for the microphone unasked.
  useEffect(() => {
    if (phase !== 'live' || !voiceCommandsOn) {
      voiceCommandsRef.current?.stop?.();
      voiceCommandsRef.current = null;
      return undefined;
    }
    if (!voiceCommandSupport.supported) {
      setListenStatus('unsupported');
      return undefined;
    }

    const commands = createVoiceCommands({
      onState: (state) =>
        setListenStatus(state === 'listening' ? 'listening' : state === 'blocked' ? 'blocked' : 'off'),
      onCommand: (id) => {
        if (recordingRef.current) return;
        if (id === 'start') {
          if (readyRef.current) arm(false);
          startTrialRef.current?.();
        }
        if (id === 'repeat') {
          arm(true);
          setCue({ text: 'READY', detail: SIGNAL_DETAIL[signalRef.current], tone: 'info' });
        }
      },
    });
    voiceCommandsRef.current = commands;
    commands.start();

    return () => {
      commands.stop();
      voiceCommandsRef.current = null;
    };
  }, [phase, voiceCommandsOn, voiceCommandSupport.supported, arm]);

  // Space bar: a solo athlete standing at the laptop still has a one-key start.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code !== 'Space' || event.repeat) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (phase !== 'live') return;
      event.preventDefault();
      startTrialRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase]);

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
  const canStart = phase === 'live' && !recording && bodyCheck.ok && !progress?.complete;

  const audioNote = !audio.supported
    ? 'This browser cannot speak. Every cue is also written on screen.'
    : audio.voiceCount === 0
      ? 'No speech voices are installed, so you will only hear the beeps. The cues stay on screen.'
      : audio.embedded
        ? 'This is an embedded preview, and browsers often block audio inside one. Open the app in its own tab if you hear nothing.'
        : null;

  const signalNote =
    signal === 'thumb' && gestureStatus === 'loading'
      ? 'Loading the hand model…'
      : signal === 'thumb' && gestureStatus === 'unavailable'
        ? 'The hand model could not load — switch to automatic or raise a hand.'
        : SIGNAL_STATUS[signal];

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

      <div className="camera-wrap" style={camera?.aspect ? { aspectRatio: String(camera.aspect) } : undefined}>
        <video ref={videoRef} autoPlay playsInline muted className={isLanding ? 'front-view' : ''} />
        <LiveSkeletonCanvas points={points} videoRef={videoRef} highlightSide={side} />

        {/* Large, high-contrast instruction so the athlete can read it from
            across the room without a second person at the keyboard. */}
        {phase === 'live' && (cue || restLeft > 0) && (
          <div className={`cue-layer tone-${cue?.tone || 'info'}`} aria-live="polite">
            <div className="cue-text">{restLeft > 0 ? restLeft : cue?.text}</div>
            {cue?.detail && restLeft <= 0 && <div className="cue-detail">{cue.detail}</div>}
            {restLeft > 0 && <div className="cue-detail">Rest — get back to the start line</div>}
            {ready && holdProgress > 0 && (
              <div className="cue-hold" role="progressbar" aria-valuenow={Math.round(holdProgress * 100)}>
                <span style={{ width: `${Math.round(holdProgress * 100)}%` }} />
              </div>
            )}
            {ready && holdProgress > 0 && holdProgress < 1 && <div className="cue-detail">Keep holding…</div>}
          </div>
        )}

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

      {phase === 'live' && (
        <div className="stack" style={{ gap: '0.5rem' }}>
          <div className="hands-free-bar">
            <span className="muted small">Start a trial by:</span>
            <div className="pill-toggle">
              {SIGNAL_MODES.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={signal === value} onClick={() => chooseSignal(value)}>
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="chip"
              aria-pressed={voiceOn}
              onClick={toggleVoice}
              disabled={!voiceSupported()}
            >
              🔊 sound {voiceOn ? 'on' : 'off'}
            </button>
            <button type="button" className="chip" onClick={testSound} disabled={!voiceOn}>
              test sound
            </button>
            {voiceCommandSupport.supported ? (
              <button type="button" className="chip" aria-pressed={voiceCommandsOn} onClick={toggleVoiceCommands}>
                🎙 voice {voiceCommandsOn ? (listenStatus === 'listening' ? 'listening' : 'on') : 'off'}
              </button>
            ) : null}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {signalNote}
          </p>
          {audioNote ? (
            <p className="muted small hud-warn" style={{ margin: 0 }}>
              {audioNote}
            </p>
          ) : null}
        </div>
      )}

      <div className="row between">
        <div className="row">
          <button className="button" type="button" onClick={() => startTrial()} disabled={!canStart}>
            {progress?.practice === false ? 'Start practice trial' : 'Start trial'}
          </button>
          <span className="muted small">or press space</span>
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
            <button className="button" type="button" onClick={() => startTrial()} disabled={!canStart}>
              {progress?.complete ? 'Leg complete' : 'Next trial now'}
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
