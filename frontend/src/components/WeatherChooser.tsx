import { useQuery } from '@tanstack/react-query';

import { getScenarios } from '@/api/client';
import { replayDateLabel } from '@/lib/dates';
import { useScenario } from '@/lib/scenario';

/**
 * Two clear buttons, "See live" and "Replay incident", and, once a replay is chosen, a date picker so a past
 * incident can be shown on purpose. Nothing is replayed unless the user presses the button.
 */
export function WeatherChooser() {
  const { scenario, setLive, setReplay } = useScenario();
  const { data, isPending, error, refetch } = useQuery({ queryKey: ['scenarios'], queryFn: getScenarios, staleTime: Infinity });
  const dates = data?.scenarios ?? [];
  const replay = scenario.mode === 'replay';

  return (
    <section className="rr-weather" aria-label="Weather for this trip">
      <div className="rr-seg" role="group" aria-label="Weather to use">
        <button type="button" className={!replay ? 'on' : ''} aria-pressed={!replay} onClick={setLive}>
          See live
        </button>
        <button
          type="button"
          className={replay ? 'on' : ''}
          aria-pressed={replay}
          disabled={isPending || dates.length === 0}
          onClick={() => dates[0] && setReplay(scenario.date ?? dates[0].date)}>
          Replay incident
        </button>
      </div>

      {replay && (
        <div className="rr-field rr-weather-date">
          <label htmlFor="incident-date">Incident date</label>
          <select id="incident-date" value={scenario.date} onChange={(e) => setReplay(e.target.value)}>
            {dates.map((d) => (
              <option key={d.date} value={d.date}>{d.label}</option>
            ))}
            {!dates.some((d) => d.date === scenario.date) && <option value={scenario.date}>{replayDateLabel(scenario.date)}</option>}
          </select>
        </div>
      )}

      <p className={replay ? 'rr-banner' : 'rr-muted'} role="status">
        {replay ? (
          <>
            <b>Replay: {replayDateLabel(scenario.date)} weather.</b> Routes are planned for that past day, not today.
          </>
        ) : (
          'Using today’s live forecast.'
        )}
      </p>
      {error && (
        <p className="rr-field-error" role="alert">
          Couldn&apos;t load the replay days. <button type="button" className="rr-link" onClick={() => refetch()}>Retry</button>
        </p>
      )}
    </section>
  );
}
