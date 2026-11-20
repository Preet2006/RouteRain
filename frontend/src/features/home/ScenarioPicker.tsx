import { useQuery } from '@tanstack/react-query';

import { getScenarios } from '@/api/client';
import { useScenario } from '@/lib/scenario';

/** Live forecast or a replay of a past monsoon day. Replay dates come from /api/v2/scenarios. */
export function ScenarioPicker() {
  const { scenario, setLive, setReplay } = useScenario();
  const { data, isPending, error, refetch } = useQuery({ queryKey: ['scenarios'], queryFn: getScenarios, staleTime: Infinity });
  const dates = data?.scenarios ?? [];

  return (
    <fieldset className="rr-fieldset rr-scenario">
      <legend>Weather to show</legend>
      <label className="rr-check">
        <input type="radio" name="scenario" checked={scenario.mode === 'live'} onChange={setLive} />
        Live forecast
      </label>
      <label className="rr-check">
        <input
          type="radio"
          name="scenario"
          checked={scenario.mode === 'replay'}
          disabled={isPending || dates.length === 0}
          onChange={() => dates[0] && setReplay(dates[0].date)}
        />
        Replay a past monsoon day
      </label>
      {scenario.mode === 'replay' && (
        <div className="rr-field">
          <label htmlFor="replay-date">Day</label>
          <select id="replay-date" value={scenario.date} onChange={(e) => setReplay(e.target.value)}>
            {dates.map((d) => (
              <option key={d.date} value={d.date}>{d.label}</option>
            ))}
            {!dates.some((d) => d.date === scenario.date) && <option value={scenario.date}>{scenario.date}</option>}
          </select>
        </div>
      )}
      {error && (
        <p className="rr-field-error" role="alert">
          Couldn&apos;t load the replay days. <button className="rr-link" onClick={() => refetch()}>Retry</button>
        </p>
      )}
    </fieldset>
  );
}
