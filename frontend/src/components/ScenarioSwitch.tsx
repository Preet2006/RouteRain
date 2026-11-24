import { useQuery } from '@tanstack/react-query';

import { getScenarios } from '@/api/client';
import { useScenario } from '@/lib/scenario';

const LIVE = 'live';

/** Compact Live / Replay selector for the top bar. Replay days come from /api/v2/scenarios. */
export function ScenarioSwitch() {
  const { scenario, setLive, setReplay } = useScenario();
  const { data } = useQuery({ queryKey: ['scenarios'], queryFn: getScenarios, staleTime: Infinity });
  const dates = data?.scenarios ?? [];
  const value = scenario.mode === 'live' ? LIVE : scenario.date;

  return (
    <div className="rr-switch">
      <label htmlFor="weather-switch" className="rr-visually-hidden">Weather to show</label>
      <select
        id="weather-switch"
        className={scenario.mode === 'replay' ? 'replay' : undefined}
        value={value}
        onChange={(e) => (e.target.value === LIVE ? setLive() : setReplay(e.target.value))}>
        <option value={LIVE}>Live forecast</option>
        {dates.map((d) => (
          <option key={d.date} value={d.date}>Replay: {d.label}</option>
        ))}
        {scenario.mode === 'replay' && !dates.some((d) => d.date === scenario.date) && (
          <option value={scenario.date}>Replay: {scenario.date}</option>
        )}
      </select>
    </div>
  );
}
