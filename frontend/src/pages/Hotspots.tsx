import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { ApiError, getHotspots } from '@/api/client';
import {
  FILTERS, atRiskCount, cardModel, countByTier, filterAndSort, filterLabel, type SortKey, type TierFilter,
} from '@/features/hotspots/model';
import { replayDateLabel } from '@/lib/dates';
import { useScenario } from '@/lib/scenario';

const isFilter = (v: string | null): v is TierFilter => FILTERS.includes(v as TierFilter);

/** All 12 hotspots as cards, with tier filters and sorting. Each card opens a full-screen detail page. */
export function Hotspots() {
  const { scenario } = useScenario();
  const replay = scenario.mode === 'replay';
  const [params, setParams] = useSearchParams();
  const filter: TierFilter = isFilter(params.get('tier')) ? (params.get('tier') as TierFilter) : 'ALL';
  const sort: SortKey = params.get('sort') === 'name' ? 'name' : 'risk';

  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ['hotspots', scenario.mode, scenario.date],
    queryFn: () => getHotspots(scenario.mode, scenario.date),
    staleTime: scenario.mode === 'live' ? 10 * 60_000 : Infinity,
  });

  const set = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const hotspots = data?.hotspots ?? [];
  const counts = countByTier(hotspots);
  const shown = filterAndSort(hotspots, filter, sort);
  const detailLink = (id: string) => `/hotspots/${id}${replay ? `?replay=${scenario.date}` : ''}`;

  return (
    <div className="rr-text rr-hotspots">
      <div className="rr-page-head">
        <div>
          <h1>Hotspots</h1>
          <p className="rr-muted">
            The 12 places in Gurugram that RouteRain watches, scored for{' '}
            {replay ? replayDateLabel(scenario.date) : 'today’s forecast'}.
          </p>
        </div>
        <label className="rr-sort">
          <span>Sort</span>
          <select value={sort} onChange={(e) => set('sort', e.target.value, 'risk')} aria-label="Sort hotspots">
            <option value="risk">Risk, high to low</option>
            <option value="name">Name, A to Z</option>
          </select>
        </label>
      </div>

      {replay && (
        <p className="rr-banner" role="status">
          <b>Replay: {replayDateLabel(scenario.date)} weather.</b> This is a past day, not today&apos;s forecast.
        </p>
      )}
      {data && !replay && data.scenario.forecast_generated_at && (
        <p className="rr-muted rr-stamp">
          Forecast updated {new Date(data.scenario.forecast_generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
      {data && !replay && atRiskCount(hotspots) === 0 && (
        <p className="rr-note">
          No rain is forecast, so every hotspot is GREEN. That is correct for today. Use “Replay incident” on the Plan trip page, or the
          selector at the top, to see how RouteRain handles a rainy day.
        </p>
      )}

      <div className="rr-filters" role="group" aria-label="Filter by risk">
        {FILTERS.filter((f) => f !== 'LOW_RAIN' || counts.LOW_RAIN > 0 || filter === 'LOW_RAIN').map((f) => {
          const n = f === 'ALL' ? hotspots.length : counts[f];
          return (
            <button key={f} type="button" className={`rr-chipbtn ${f}`} aria-pressed={filter === f} onClick={() => set('tier', f, 'ALL')}>
              {filterLabel(f)} <span className="rr-chipcount">{data ? n : '–'}</span>
            </button>
          );
        })}
      </div>

      {isPending && (
        <div className="rr-card-grid" aria-busy="true" aria-label="Loading hotspots">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="rr-hcard skeleton"><div className="rr-skeleton" style={{ width: '60%' }} /><div className="rr-skeleton" /><div className="rr-skeleton" style={{ width: '80%' }} /></div>
          ))}
        </div>
      )}
      {isPending && (
        <p className="rr-muted">
          {replay ? 'Scoring that day for 12 hotspots. The first replay can take up to 20 seconds.' : 'Fetching today’s forecast for 12 hotspots. The first load can take up to 30 seconds.'}
        </p>
      )}

      {error && (
        <div className="rr-error" role="alert">
          <b>{error instanceof ApiError && error.kind === 'network' ? "Can't reach RouteRain server" : 'Hotspots could not be loaded'}</b>
          <p>{error instanceof ApiError ? error.message : 'Something went wrong.'}</p>
          <button className="rr-btn" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Trying…' : 'Retry'}</button>
        </div>
      )}

      {data && shown.length === 0 && (
        <p className="rr-muted">No hotspots match this filter. <button type="button" className="rr-link" onClick={() => set('tier', 'ALL', 'ALL')}>Show all</button></p>
      )}

      {data && shown.length > 0 && (
        <ul className="rr-card-grid" aria-label="Hotspots">
          {shown.map((h) => {
            const c = cardModel(h, replay);
            return (
              <li key={c.id} className={`rr-hcard ${c.tier}`}>
                <div className="rr-hcard-strip" style={{ background: c.color }} aria-hidden="true" />
                <div className="rr-hcard-body">
                  <span className={`rr-tier ${c.tier}`}><span aria-hidden="true">{c.glyph}</span> {c.word}</span>
                  <h2>{c.name}</h2>
                  {c.area && <p className="rr-hcard-area">{c.area}</p>}
                  <p className="rr-hcard-risk"><b>{c.risk}</b></p>
                  <p className="rr-hcard-reason">{c.reason}</p>
                  {c.reported && <p className="rr-hcard-reported"><span>Reported that day:</span> <b>{c.reported}</b></p>}
                </div>
                <Link to={detailLink(c.id)} className="rr-btn rr-hcard-btn" aria-label={`View in detail: ${c.name}`}>View in detail</Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
