import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ScenarioChoice = { mode: 'live'; date: null } | { mode: 'replay'; date: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const LIVE: ScenarioChoice = { mode: 'live', date: null };

/** A replay only starts if the address says so (?replay=2026-08-07, handy for demo links). Otherwise: Live. */
function fromUrl(): ScenarioChoice {
  try {
    const d = new URLSearchParams(window.location.search).get('replay');
    if (d && DATE.test(d)) return { mode: 'replay', date: d };
  } catch {
    /* no window: default to live */
  }
  return LIVE;
}

type Ctx = { scenario: ScenarioChoice; setLive: () => void; setReplay: (date: string) => void };
const ScenarioContext = createContext<Ctx | null>(null);

/**
 * Which weather the site is showing (live forecast or a replay day). Shared by every page so a route is always
 * computed for the weather on screen. It always starts on LIVE: a replay is never selected automatically, and the
 * choice is kept in memory only (a reload goes back to live).
 */
export function ScenarioProvider({ children, initial }: { children: ReactNode; initial?: ScenarioChoice }) {
  const [scenario, setScenario] = useState<ScenarioChoice>(initial ?? fromUrl);
  const setLive = useCallback(() => setScenario(LIVE), []);
  const setReplay = useCallback((date: string) => {
    if (DATE.test(date)) setScenario({ mode: 'replay', date });
  }, []);
  const value = useMemo(() => ({ scenario, setLive, setReplay }), [scenario, setLive, setReplay]);
  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>;
}

export function useScenario(): Ctx {
  const ctx = useContext(ScenarioContext);
  if (!ctx) throw new Error('useScenario must be used inside <ScenarioProvider>');
  return ctx;
}
