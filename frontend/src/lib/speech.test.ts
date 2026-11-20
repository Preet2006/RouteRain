import { describe, expect, it, vi } from 'vitest';

import { createSpeech, hasVoiceFor, pickVoice, type VoiceLike } from './speech';

const v = (name: string, lang: string): VoiceLike => ({ name, lang, default: false });
const VOICES = [v('Google US English', 'en-US'), v('Google UK English', 'en-GB'), v('Rishi', 'en-IN'), v('Lekha', 'hi-IN')];

describe('pickVoice', () => {
  it('prefers en-IN for English and hi-IN for Hindi', () => {
    expect(pickVoice(VOICES, 'en')?.name).toBe('Rishi');
    expect(pickVoice(VOICES, 'hi')?.name).toBe('Lekha');
  });
  it('falls back to any English voice when en-IN is missing', () => {
    expect(pickVoice(VOICES.slice(0, 2), 'en')?.name).toBe('Google US English');
  });
  it('accepts underscore language tags (Android style)', () => {
    expect(pickVoice([v('x', 'hi_IN')], 'hi')?.name).toBe('x');
  });
  it('returns null for Hindi when no Hindi voice exists, and for an empty list', () => {
    expect(pickVoice(VOICES.slice(0, 3), 'hi')).toBeNull();
    expect(pickVoice([], 'en')).toBeNull();
    expect(hasVoiceFor(VOICES.slice(0, 3), 'hi')).toBe(false);
    expect(hasVoiceFor(VOICES, 'hi')).toBe(true);
  });
});

function fakeSynth(initial: VoiceLike[]) {
  let voices = initial;
  const listeners: (() => void)[] = [];
  const synth = {
    getVoices: () => voices as SpeechSynthesisVoice[],
    speak: vi.fn((u: { onend?: () => void; onerror?: () => void }) => queueMicrotask(() => u.onend?.())),
    cancel: vi.fn(),
    speaking: false,
    addEventListener: (_t: 'voiceschanged', l: () => void) => void listeners.push(l),
    removeEventListener: (_t: 'voiceschanged', l: () => void) => void listeners.splice(listeners.indexOf(l), 1),
  };
  return { synth, arrive: (vs: VoiceLike[]) => { voices = vs; [...listeners].forEach((l) => l()); } };
}
const utterance = (text: string) => ({ text, lang: '', voice: null }) as unknown as SpeechSynthesisUtterance;

describe('speech wrapper', () => {
  it('waits for voiceschanged before choosing a voice', async () => {
    const { synth, arrive } = fakeSynth([]);
    const speech = createSpeech(() => synth as never, utterance);
    const spoken = speech.speak('Hello', 'hi');
    arrive(VOICES);
    expect(await spoken).toBe(true);
    const used = synth.speak.mock.calls[0][0] as unknown as SpeechSynthesisUtterance;
    expect(used.voice).toMatchObject({ name: 'Lekha' });
    expect(used.lang).toBe('hi-IN');
  });

  it('cancels the previous line before speaking and falls back to English when Hindi is missing', async () => {
    const { synth } = fakeSynth(VOICES.slice(0, 3));
    const speech = createSpeech(() => synth as never, utterance);
    expect(await speech.hasHindi()).toBe(false);
    await speech.speak('namaste', 'hi');
    expect(synth.cancel).toHaveBeenCalled();
    const used = synth.speak.mock.calls[0][0] as unknown as SpeechSynthesisUtterance;
    expect(used.voice).toMatchObject({ lang: 'en-IN' });
  });

  it('stop() cancels and isSpeaking() reflects the engine', () => {
    const { synth } = fakeSynth(VOICES);
    synth.speaking = true;
    const speech = createSpeech(() => synth as never, utterance);
    expect(speech.isSpeaking()).toBe(true);
    speech.stop();
    expect(synth.cancel).toHaveBeenCalled();
  });

  it('degrades quietly when speech is unsupported', async () => {
    const speech = createSpeech(() => null, utterance);
    expect(speech.isSupported()).toBe(false);
    expect(await speech.speak('hi')).toBe(false);
    expect(await speech.hasHindi()).toBe(false);
    expect(speech.isSpeaking()).toBe(false);
    expect(() => speech.stop()).not.toThrow();
  });

  it('ignores empty text and survives a throwing engine', async () => {
    const { synth } = fakeSynth(VOICES);
    synth.speak.mockImplementation(() => {
      throw new Error('boom');
    });
    const speech = createSpeech(() => synth as never, utterance);
    expect(await speech.speak('   ')).toBe(false);
    expect(await speech.speak('hello')).toBe(false);
  });

  it('resolves false when the engine reports an error', async () => {
    const { synth } = fakeSynth(VOICES);
    synth.speak.mockImplementation((u: { onerror?: () => void }) => queueMicrotask(() => u.onerror?.()));
    expect(await createSpeech(() => synth as never, utterance).speak('hello')).toBe(false);
  });
});
