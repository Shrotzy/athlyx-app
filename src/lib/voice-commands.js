/**
 * Voice commands, as an alternative to the button or the hand gesture.
 *
 * Uses the browser's SpeechRecognition (Chrome and Edge today). It is never
 * required: if the browser has no implementation, the caller falls back to the
 * gesture and the button without changing anything else.
 *
 * The microphone is only open while the runner page is on screen and the
 * camera session is live, and only the matched command word is ever used —
 * nothing is recorded, stored or sent by this app.
 */

const COMMANDS = [
  { id: 'start', pattern: /\b(start|start trial|ready|go|begin|next|hop)\b/i },
  { id: 'repeat', pattern: /\b(repeat|again|redo|retry)\b/i },
];

export function parseCommand(transcript) {
  if (!transcript) return null;
  for (const command of COMMANDS) {
    if (command.pattern.test(transcript)) return command.id;
  }
  return null;
}

export function commandSupport() {
  if (typeof window === 'undefined') return { supported: false, reason: 'unsupported' };
  const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Impl) {
    return {
      supported: false,
      reason: 'unsupported',
      message:
        'Voice commands need Chrome or Edge. The hand gesture and the on-screen button work in every browser.',
    };
  }
  if (!window.isSecureContext) {
    return { supported: false, reason: 'insecure', message: 'Voice commands need an HTTPS page (or localhost).' };
  }
  return { supported: true, Impl };
}

/**
 * @param {{onCommand?: (id: string, transcript: string) => void, onState?: (state: string) => void}} handlers
 */
export function createVoiceCommands({ onCommand, onState } = {}) {
  const support = commandSupport();
  if (!support.supported) {
    onState?.('unsupported');
    return { supported: false, start() {}, stop() {} };
  }

  const recognition = new support.Impl();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  let active = false;
  let restartTimer = 0;

  recognition.addEventListener('result', (event) => {
    // Do not let our own spoken cues be recognised as commands.
    if (typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.speaking) return;
    let transcript = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) transcript += ` ${result[0]?.transcript || ''}`;
    }
    const command = parseCommand(transcript);
    if (command) onCommand?.(command, transcript.trim());
  });

  recognition.addEventListener('error', (event) => {
    if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
      active = false;
      onState?.('blocked');
    }
  });

  recognition.addEventListener('start', () => onState?.('listening'));

  recognition.addEventListener('end', () => {
    if (!active) return;
    clearTimeout(restartTimer);
    // Chrome stops listening after a pause; restart while the runner is live.
    restartTimer = setTimeout(() => {
      if (!active) return;
      try {
        recognition.start();
      } catch {
        /* a start is already pending */
      }
    }, 400);
  });

  return {
    supported: true,
    start() {
      if (active) return;
      active = true;
      try {
        recognition.start();
        onState?.('listening');
      } catch {
        /* already starting */
      }
    },
    stop() {
      active = false;
      clearTimeout(restartTimer);
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
      onState?.('stopped');
    },
  };
}
