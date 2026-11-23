/**
 * Thin wrapper over the browser's speech synthesis (Web Speech API).
 *  - waits for the voice list (Chrome fills it asynchronously: `voiceschanged`),
 *  - prefers an en-IN / hi-IN voice and falls back to any English voice,
 *  - exposes speak / stop / isSpeaking / hasHindi,
 *  - cancels speech on page change (see useStopSpeechOnNavigate).
 * Everything degrades quietly when speech is unsupported: speak() just resolves false.
 */

export type SpeechLanguage = 'en' | 'hi';

export type SpeakResult = 'ended' | 'blocked' | 'interrupted' | 'failed' | 'unsupported';

type SynthLike = Pick<SpeechSynthesis, 'getVoices' | 'speak' | 'cancel' | 'speaking'> & {
  addEventListener?: (type: 'voiceschanged', listener: () => void) => void;
  removeEventListener?: (type: 'voiceschanged', listener: () => void) => void;
};

const LANG_TAG: Record<SpeechLanguage, string> = { en: 'en-IN', hi: 'hi-IN' };

export type VoiceLike = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'default'>;

/** Pure voice choice, exported for tests. Returns null when nothing suitable exists. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], language: SpeechLanguage): V | null {
  const lang = (v: VoiceLike) => v.lang.replace('_', '-').toLowerCase();
  const exact = voices.find((v) => lang(v) === LANG_TAG[language].toLowerCase());
  if (exact) return exact;
  const sameLanguage = voices.find((v) => lang(v).startsWith(language));
  if (sameLanguage) return sameLanguage;
  return null; // e.g. no Hindi voice on this device: the caller falls back to English
}

/** English fallback used when the wanted language has no voice. */
export function pickEnglishFallback<V extends VoiceLike>(voices: readonly V[]): V | null {
  return pickVoice(voices, 'en');
}

export function hasVoiceFor(voices: readonly VoiceLike[], language: SpeechLanguage): boolean {
  return pickVoice(voices, language) !== null;
}

export function createSpeech(
  getSynth: () => SynthLike | null,
  makeUtterance: (text: string) => SpeechSynthesisUtterance,
) {
  let voices: SpeechSynthesisVoice[] = [];
  let ready: Promise<SpeechSynthesisVoice[]> | null = null;

  function synth() {
    try {
      return getSynth();
    } catch {
      return null;
    }
  }

  /** Resolves with the voice list as soon as the browser has one (or after 1.5 s with whatever exists). */
  function loadVoices(): Promise<SpeechSynthesisVoice[]> {
    if (ready) return ready;
    const s = synth();
    if (!s) return (ready = Promise.resolve([]));
    ready = new Promise((resolve) => {
      const done = () => {
        voices = s.getVoices();
        s.removeEventListener?.('voiceschanged', onChange);
        clearTimeout(timer);
        resolve(voices);
      };
      const onChange = () => {
        if (s.getVoices().length) done();
      };
      const timer = setTimeout(done, 1500);
      if (s.getVoices().length) return done();
      s.addEventListener?.('voiceschanged', onChange);
    });
    return ready;
  }

  return {
    isSupported: () => synth() !== null,
    loadVoices,
    /** Does this device have a voice for the language? (Hindi often does not.) */
    async hasVoice(language: SpeechLanguage) {
      return hasVoiceFor(await loadVoices(), language);
    },
    async hasHindi() {
      return hasVoiceFor(await loadVoices(), 'hi');
    },
    /**
     * Speaks text and says how it ended: 'ended' (finished), 'blocked' (the browser refuses speech before the
     * user has interacted with the page), 'interrupted' (stop() or another line cancelled it), 'failed', or
     * 'unsupported' (no speech engine, or nothing to say).
     */
    async speakResult(text: string, language: SpeechLanguage = 'en'): Promise<SpeakResult> {
      const s = synth();
      if (!s || !text.trim()) return 'unsupported';
      const list = await loadVoices();
      s.cancel(); // never overlap two lines
      const utterance = makeUtterance(text);
      const voice = pickVoice(list, language) ?? pickEnglishFallback(list);
      if (voice) utterance.voice = voice as SpeechSynthesisVoice;
      utterance.lang = voice ? voice.lang : LANG_TAG[language];
      return new Promise<SpeakResult>((resolve) => {
        utterance.onend = () => resolve('ended');
        utterance.onerror = (e: SpeechSynthesisErrorEvent) =>
          resolve(e?.error === 'not-allowed' ? 'blocked' : e?.error === 'interrupted' || e?.error === 'canceled' ? 'interrupted' : 'failed');
        try {
          s.speak(utterance);
        } catch {
          resolve('failed');
        }
      });
    },
    /** Speaks text; resolves true only when it finished. */
    async speak(text: string, language: SpeechLanguage = 'en'): Promise<boolean> {
      return (await this.speakResult(text, language)) === 'ended';
    },
    stop() {
      try {
        synth()?.cancel();
      } catch {
        /* nothing to stop */
      }
    },
    isSpeaking() {
      return synth()?.speaking ?? false;
    },
  };
}

export const speech = createSpeech(
  () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null),
  (text) => new SpeechSynthesisUtterance(text),
);
