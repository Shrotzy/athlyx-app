/**
 * Spoken cues.
 *
 * The athlete stands two to three metres from the screen during a trial, so
 * every instruction is also said out loud. This uses the browser's built-in
 * speech synthesis: no API key, no network request, no audio files to ship.
 *
 * Sound is a convenience, never the only channel: the same instruction is
 * always drawn on screen in large type, and every trial can be started with a
 * button as well. If a browser cannot speak, everything else still works.
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

/** Spoken versions of the on-screen cue text. Kept together so they never drift. */
export const CUES = {
  practiceIntro: 'This is a practice trial. It is not scored.',
  hopStart: 'Hop when you are ready.',
  stepStart: 'Step off the step when you are ready.',
  hopReady: 'Ready when you are. Show a thumbs up, or say ready.',
  holdIt: 'Hold it.',
  trialSaved: (distanceCm) =>
    Number.isFinite(distanceCm) ? `Trial saved. ${Math.round(distanceCm)} centimetres.` : 'Trial saved.',
  landingSaved: 'Trial saved.',
  trialVoided: 'That trial was voided. Let us try again.',
  rest: (seconds) => `Nice. Rest for ${seconds} seconds.`,
  legComplete: 'This leg is complete. You can stop the camera, or move to the next test.',
  stepBack: 'Step back so your feet are in frame.',
  handsFreeUnavailable:
    'Hands-free start is unavailable in this browser. Use the on-screen button or the space bar.',
};
