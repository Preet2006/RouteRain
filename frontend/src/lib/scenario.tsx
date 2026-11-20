import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ScenarioChoice = { mode: 'live'; date: null } | { mode: 'replay'; date: string };

const KEY = 'routerain.scenario';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function read(): ScenarioChoice {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null');
    if (parsed?.mode === 'replay' && typeof parsed.date === 'string' && DATE.test(parsed.date)) {
      return { mode: 'replay', date: parsed.date };
    }
  } catch {
    /* storage blocked or corrupt: default to live */
  }
  return { mode: 'live', date: null };
}

function write(choice: ScenarioChoice) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    /* kept in memory only */
  }
}

type Ctx = { scenario: ScenarioChoice; setLive: () => void; setReplay: (date: string) => void };
const ScenarioContext = createContext<Ctx | null>(null);

/**
 * Which weather the site is showing (live forecast or a replay day). Shared by Home and, later, trip planning
 * so a route is always computed for the scenario on screen. Kept for the browser session only.
 */
export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenario] = useState<ScenarioChoice>(read);
  const setLive = useCallback(() => {
    const next: ScenarioChoice = { mode: 'live', date: null };
    setScenario(next);
    write(next);
  }, []);
  const setReplay = useCallback((date: string) => {
    if (!DATE.test(date)) return;
    const next: ScenarioChoice = { mode: 'replay', date };
    setScenario(next);
    write(next);
  }, []);
  const value = useMemo(() => ({ scenario, setLive, setReplay }), [scenario, setLive, setReplay]);
  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>;
}

export function useScenario(): Ctx {
  const ctx = useContext(ScenarioContext);
  if (!ctx) throw new Error('useScenario must be used inside <ScenarioProvider>');
  return ctx;
}
