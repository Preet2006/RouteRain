import { useEffect, useState } from 'react';

import { speech } from './speech';

/** undefined while the browser's voice list is still loading, then true/false. */
export function useHasHindi(): boolean | undefined {
  const [has, setHas] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    speech.hasHindi().then((v) => alive && setHas(v));
    return () => {
      alive = false;
    };
  }, []);
  return has;
}

export const TEST_VOICE_LINE = {
  en: 'This is RouteRain. Voice advice is switched on.',
  hi: 'यह RouteRain है। आवाज़ वाली सलाह चालू है।',
} as const;
