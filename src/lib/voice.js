/**
 * Spoken cues.
 *
 * The athlete stands two to three metres from the screen during a trial, so
 * every instruction is also said out loud. This uses the browser's built-in
 * speech synthesis: no API key, no network request, no audio files to ship.
 *
 * Sound is a convenience, never the only channel: the same instruction is
 * always drawn on screen in large type, and every trial can be started with a
 * button or the space bar as well. If a browser cannot speak, everything else
 * still works, and the runner says so.
 */

const MUTED_KEY = 'athlyx.voice.muted';

let muted = (() => {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
})();

let unlocked = false;
let cachedVoice = null;

export function voiceSupported() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

export function voiceMuted() {
  return muted;
}

export function setVoiceMuted(next) {
  muted = Boolean(next);
  try {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    /* private mode */
  }
  if (muted) cancelSpeech();
  return muted;
}

export function cancelSpeech() {
  if (!voiceSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* nothing to cancel */
  }
}

function pickVoice() {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices?.() || [];
  if (voices.length === 0) return null;
  cachedVoice =
    voices.find((voice) => voice.lang === 'en-GB' && voice.localService) ||
    voices.find((voice) => /^en[-_]/i.test(voice.lang) && voice.localService) ||
    voices.find((voice) => /^en[-_]/i.test(voice.lang)) ||
    voices[0];
  return cachedVoice;
}

/**
 * Some browsers (notably iOS Safari) only allow speech after a real user
 * gesture. Call this from the click that starts the camera.
 */
export function unlockVoice() {
  if (!voiceSupported() || unlocked) return;
  unlocked = true;
  try {
    const warmUp = new window.SpeechSynthesisUtterance(' ');
    warmUp.volume = 0;
    window.speechSynthesis.speak(warmUp);
  } catch {
    /* speaking will simply stay silent */
  }
  try {
    // The voice list often arrives asynchronously.
    window.speechSynthesis.addEventListener?.('voiceschanged', () => {
      cachedVoice = null;
      pickVoice();
    });
  } catch {
    /* older browsers */
  }
}

/**
 * Say something. By default this interrupts the previous cue: a stale
 * instruction spoken half a second late is worse than none.
 */
export function speak(text, { interrupt = true, rate = 1.02 } = {}) {
  if (!text || muted || !voiceSupported()) return;
  const synth = window.speechSynthesis;
  try {
    if (interrupt) synth.cancel();
    const utterance = new window.SpeechSynthesisUtterance(String(text));
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-GB';
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;
    synth.speak(utterance);
  } catch (error) {
    console.warn('[voice] could not speak:', error?.message || error);
  }
}

let audioContext = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Impl = window.AudioContext || window.webkitAudioContext;
  if (!Impl) return null;
  try {
    if (!audioContext) audioContext = new Impl();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  } catch {
    return null;
  }
}

/**
 * A short beep cue. This keeps the countdown usable when a browser has no
 * installed speech voices, or when an embedded preview blocks audio: two rising
 * notes mean "go".
 */
export function chime(kind = 'tick') {
  if (muted) return;
  const context = getAudioContext();
  if (!context) return;
  const start = context.currentTime;
  const notes = kind === 'go' ? [660, 990] : kind === 'ready' ? [520, 700] : [520];

  notes.forEach((frequency, index) => {
    const at = start + index * 0.12;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.2);
  });
}

/**
 * What is actually available right now, so a silent cue can be explained
 * instead of guessed at.
 */
export function voiceDiagnostics() {
  const supported = voiceSupported();
  let voiceCount = 0;
  if (supported) {
    try {
      voiceCount = (window.speechSynthesis.getVoices?.() || []).length;
    } catch {
      voiceCount = 0;
    }
  }
  let embedded = false;
  try {
    embedded = window.self !== window.top;
  } catch {
    embedded = true;
  }
  return { supported, voiceCount, muted, embedded };
}

/**
 * Encouragement. Short, specific and never a clinical claim: it reacts to the
 * attempt, not to the result. Rotated by trial so it does not become wallpaper.
 */
export const AFFIRMATIONS = [
  'Nice.',
  'Good rep.',
  'That looked strong.',
  'Well done.',
  'Lovely landing.',
  'That is the one.',
];

export function affirmationFor(index) {
  const safe = Math.abs(Math.trunc(Number(index) || 0));
  return AFFIRMATIONS[safe % AFFIRMATIONS.length];
}

/** Spoken versions of the on-screen cue text. Kept together so they never drift. */
export const CUES = {
  cameraOn:
    'Camera on. Stand back until your feet are in frame, then hold the start position when you are ready.',
  sideCamera:
    'Film this test from the side. Turn ninety degrees so your hop travels across the screen, not towards the camera.',
  frontCamera: 'Film this test from the front. Face the camera and keep your hips square.',
  readyToGo: 'Ready to go? Put both hands on top of your head.',
  readyToGoAuto: 'Ready to go. Starting in three, two, one.',
  practiceIntro: 'This first one is your practice trial. It is not scored.',
  practiceDone: 'Nice. That is the practice trial done. Three scored trials to go.',
  hopStart: 'Hop when you are ready.',
  stepStart: 'Step off the step when you are ready.',
  holdIt: 'Hold it.',
  trialSaved: (distanceCm) =>
    Number.isFinite(distanceCm) ? `Trial saved. ${Math.round(distanceCm)} centimetres.` : 'Trial saved.',
  landingSaved: 'Trial saved.',
  trialVoided: 'No problem at all. That one did not count, so let us try it again.',
  rest: (seconds) => `Rest for ${seconds} seconds.`,
  legComplete: 'That is this leg done. Good work. Head back to the check-in for the next test.',
  stepBack: 'Step back so your feet are in frame.',
  tryAgainWhenReady: 'Take your time. When you are ready, show the start position again.',
  attemptsUsed: `That is all the attempts for this leg, and it still needs three valid trials. Start this leg again when you are ready.`,
};
