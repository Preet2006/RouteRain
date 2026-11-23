import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { narrate } from '@/api/client';
import type { RouteResponse } from '@/api/schemas';
import { speech, type SpeechLanguage } from '@/lib/speech';
import type { Profile } from '@/lib/storage';
import { useHasHindi } from '@/lib/useHasHindi';

/** How long to wait for the AI-phrased line before reading the standard one instead. */
export const NARRATION_WAIT_MS = 7000;

/** Only the first word of the name ever leaves the browser. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

export type VoiceState = 'preparing' | 'speaking' | 'idle' | 'blocked' | 'failed' | 'unsupported';

/** True when the browser says the user has not interacted with the page yet (speech would be blocked). */
function noUserActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua !== undefined && !ua.hasBeenActive;
}

/**
 * The advice sentence for a route, shown and spoken as the SAME string:
 *  - the standard sentence is available immediately (it comes with the route),
 *  - the AI-phrased sentence is requested in parallel and replaces it if it arrives in time,
 *  - once voice starts, the text is frozen so what you hear is exactly what you read.
 * Auto-play happens once per route, only if voice is on and the browser allows it; otherwise a Play button is offered.
 */
export function useAdvice(route: RouteResponse | undefined, profile: Pick<Profile, 'name' | 'language' | 'voiceOn'>) {
  const hasHindi = useHasHindi();
  const wantsHindi = profile.language === 'hi';
  const languageKnown = !wantsHindi || hasHindi !== undefined;
  const language: SpeechLanguage = wantsHindi && hasHindi ? 'hi' : 'en';

  const narration = useQuery({
    queryKey: ['narrate', route?.route_id, language, firstName(profile.name)],
    queryFn: () => narrate({ route_id: route!.route_id, user_name: firstName(profile.name) || null, language }),
    enabled: !!route && languageKnown,
    staleTime: Infinity,
    retry: false,
  });
  const settled = narration.isSuccess || narration.isError;

  const [waited, setWaited] = useState(false);
  type Line = { text: string; language: SpeechLanguage; source: 'llm' | 'template' };
  const [frozen, setFrozen] = useState<Line | null>(null);
  const [voice, setVoice] = useState<VoiceState>('preparing');
  const autoFor = useRef<string | null>(null);
  const stoppedByUser = useRef(false);

  const live: Line | null = narration.data
    ? { text: narration.data.text, language: narration.data.language as SpeechLanguage, source: narration.data.source }
    : route
      ? { text: route.template_advice, language: 'en', source: 'template' }
      : null;
  const shown = frozen ?? live;

  useEffect(() => {
    setWaited(false);
    if (!route) return;
    const t = setTimeout(() => setWaited(true), NARRATION_WAIT_MS);
    return () => clearTimeout(t);
  }, [route?.route_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const speakNow = useCallback(async (text: string, lang: SpeechLanguage) => {
    stoppedByUser.current = false;
    setVoice('speaking');
    const result = await speech.speakResult(text, lang);
    if (stoppedByUser.current || result === 'interrupted') setVoice('idle');
    else if (result === 'ended') setVoice('idle');
    else setVoice(result === 'blocked' ? 'blocked' : result === 'unsupported' ? 'unsupported' : 'failed');
  }, []);

  // Auto-play once per route.
  useEffect(() => {
    if (!route || !live || autoFor.current === route.route_id) return;
    if (!(settled || waited)) return;
    autoFor.current = route.route_id;
    setFrozen(live);
    if (!profile.voiceOn) {
      setVoice('idle');
      return;
    }
    if (!speech.isSupported()) {
      setVoice('unsupported');
      return;
    }
    if (noUserActivation()) {
      setVoice('blocked');
      return;
    }
    void speakNow(live.text, live.language);
  }, [route, live, settled, waited, profile.voiceOn, speakNow]);

  // Never keep talking after leaving the page.
  useEffect(() => () => speech.stop(), []);

  return {
    text: shown?.text ?? '',
    source: shown?.source ?? 'template',
    pending: !frozen && !settled && !waited,
    voice,
    speaking: voice === 'speaking',
    play: () => shown && void speakNow(shown.text, shown.language),
    stop: () => {
      stoppedByUser.current = true;
      speech.stop();
      setVoice('idle');
    },
  };
}
