import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, getHotspots } from '@/api/client';
import { HotspotDetails } from '@/features/home/HotspotDetails';
import { HotspotMap } from '@/features/home/HotspotMap';
import { probabilityBand, sortHotspots } from '@/features/home/markers';
import type { SavedPlace } from '@/lib/storage';
import { useScenario } from '@/lib/scenario';
import { useProfile } from '@/lib/useProfile';
import { TIER_ORDER, tierInfo } from '@/theme';

export function replayDateLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function Home() {
  const { profile } = useProfile();
  const { scenario } = useScenario();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ['hotspots', scenario.mode, scenario.date],
    queryFn: () => getHotspots(scenario.mode, scenario.date),
    staleTime: scenario.mode === 'live' ? 10 * 60_000 : Infinity,
  });

  const hotspots = data?.hotspots ?? [];
  const selected = hotspots.find((h) => h.id === selectedId) ?? null;
  const replay = scenario.mode === 'replay';
  const allGreenLive = !replay && data !== undefined && data.tiers.RED + data.tiers.YELLOW === 0;
  const goTo = (place: SavedPlace) => navigate('/plan', { state: { destination: place } });
  const chips: { label: string; place: SavedPlace }[] = [
    ...(profile.home ? [{ label: 'Home', place: profile.home }] : []),
    ...(profile.work ? [{ label: 'Work', place: profile.work }] : []),
    ...profile.recentTrips.slice(0, 3).map((t) => ({ label: t.destination.label, place: t.destination })),
  ];

  return (
    <div className="rr-home">
      <section className="rr-home-panel" aria-label="Overview">
        <h1>Hotspots</h1>

        <button type="button" className="rr-where" onClick={() => navigate('/plan')}>
          Where are you going?
          <span aria-hidden="true">→</span>
        </button>
        {chips.length > 0 && (
          <div className="rr-chips" aria-label="Quick destinations">
            {chips.map((c, i) => (
              <button key={`${c.label}-${i}`} type="button" className="rr-chip" onClick={() => goTo(c.place)}>{c.label}</button>
            ))}
          </div>
        )}

        {replay && (
          <p className="rr-banner" role="status">
            <b>Replay: {replayDateLabel(scenario.date)} weather.</b> This is a past day, not today&apos;s forecast.
          </p>
        )}

        {isPending && (
          <div className="rr-card" aria-busy="true" aria-label="Loading hotspots">
            <div className="rr-skeleton" style={{ width: '80%' }} />
            <div className="rr-skeleton" style={{ width: '55%' }} />
            <div className="rr-skeleton" style={{ width: '70%' }} />
            <p className="rr-muted">
              {replay
                ? 'Scoring that day for 12 hotspots. The first replay can take up to 20 seconds.'
                : 'Fetching today’s forecast for 12 hotspots. The first load can take up to 30 seconds.'}
            </p>
          </div>
        )}

        {error && (
          <div className="rr-error" role="alert">
            <b>{error instanceof ApiError && error.kind === 'network' ? "Can't reach RouteRain server" : 'Hotspots could not be loaded'}</b>
            <p>{error instanceof ApiError ? error.message : 'Something went wrong.'}</p>
            <button className="rr-btn" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Trying…' : 'Retry'}</button>
          </div>
        )}

        {data && (
          <>
            <p className="rr-muted rr-stamp">
              {data.scenario.mode === 'live' && data.scenario.forecast_generated_at
                ? `Forecast updated ${new Date(data.scenario.forecast_generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : data.scenario.date
                  ? `Replay of ${replayDateLabel(data.scenario.date)}`
                  : ''}
            </p>
            <ul className="rr-counts" aria-label="Hotspots by risk">
              {TIER_ORDER.filter((t) => t !== 'LOW_RAIN' || data.tiers.LOW_RAIN > 0).map((t) => (
                <li key={t} className={`rr-count ${t}`}>
                  <b>{data.tiers[t]}</b>
                  <span><span aria-hidden="true">{tierInfo(t).glyph}</span> {tierInfo(t).word}</span>
                </li>
              ))}
            </ul>
            {allGreenLive && (
              <p className="rr-note">
                No rain is forecast, so every hotspot is GREEN. That is correct for today. Choose “Replay a past monsoon day” to see how RouteRain handles a rainy day.
              </p>
            )}
          </>
        )}

        {selected && <HotspotDetails hotspot={selected} replay={replay} onClose={() => setSelectedId(null)} />}

        {hotspots.length > 0 && (
          <>
            <h2>Hotspots</h2>
            <ul className="rr-hotspot-list">
              {sortHotspots(hotspots).map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className={`rr-hotspot-row${h.id === selectedId ? ' selected' : ''}`}
                    aria-pressed={h.id === selectedId}
                    onClick={() => setSelectedId(h.id === selectedId ? null : h.id)}>
                    <span className={`rr-tier ${h.tier}`}><span aria-hidden="true">{tierInfo(h.tier).glyph}</span> {tierInfo(h.tier).word}</span>
                    <span className="rr-hotspot-name">{h.name}</span>
                    <small className="rr-muted">{probabilityBand(h.probability) ?? 'not scored'}</small>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="rr-muted rr-caveat">A guide, not a guarantee.</p>
      </section>

      <div className="rr-home-map">
        <HotspotMap hotspots={hotspots} selectedId={selectedId} onSelect={setSelectedId} loading={isPending && !error} />
      </div>
    </div>
  );
}
