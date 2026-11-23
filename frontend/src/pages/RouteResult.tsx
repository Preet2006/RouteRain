import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError, getRoute } from '@/api/client';
import { compareRows, effectLine } from '@/features/route/format';
import { RouteMap } from '@/features/route/RouteMap';
import { useAdvice } from '@/features/route/useAdvice';
import { replayDateLabel } from '@/pages/Home';
import { useProfile } from '@/lib/useProfile';
import { tierInfo } from '@/theme';

export function RouteResult() {
  const { routeId = '' } = useParams();
  const { profile, store } = useProfile();
  const { data: route, error, isPending } = useQuery({
    queryKey: ['route', routeId],
    queryFn: () => getRoute(routeId),
    retry: false,
    staleTime: Infinity,
  });
  const advice = useAdvice(route, profile);

  // Remember the trip once its route has loaded (a failed or expired route is never saved).
  useEffect(() => {
    if (!route) return;
    store.addRecentTrip(
      { label: route.origin.label || 'Start', lat: route.origin.lat, lon: route.origin.lon },
      { label: route.destination.label || 'Destination', lat: route.destination.lat, lon: route.destination.lon },
    );
  }, [route?.route_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isPending) {
    return (
      <>
        <h1>Finding your route…</h1>
        <div className="rr-skeleton" aria-busy="true" style={{ width: '60%' }} />
        <div className="rr-skeleton" style={{ width: '40%' }} />
      </>
    );
  }
  if (error || !route) {
    return (
      <>
        <h1>Route result</h1>
        <div className="rr-error" role="alert">
          <b>{error instanceof ApiError ? error.message : "Can't reach the RouteRain server."}</b>
          <p><Link to="/plan">Plan it again</Link></p>
        </div>
      </>
    );
  }

  const replay = route.scenario.mode === 'replay' && route.scenario.date;
  const effect = effectLine(route);
  const rows = compareRows(route);
  const why = route.avoided_hotspots;

  return (
    <div className="rr-result">
      <div className="rr-result-main">
        <h1>
          {route.origin.label || 'Start'} <span aria-hidden="true">→</span>
          <span className="rr-visually-hidden"> to </span> {route.destination.label || 'Destination'}
        </h1>

        {replay && (
          <p className="rr-banner" role="status">
            <b>Replay: {replayDateLabel(route.scenario.date as string)} weather.</b> This is a past day, not today&apos;s forecast.
          </p>
        )}

        <section className="rr-card rr-advice" aria-labelledby="advice-h">
          <h2 id="advice-h">Advice</h2>
          <p className="rr-headline" data-testid="advice-text">{advice.text}</p>
          <p className="rr-muted rr-advice-meta">
            <span className="rr-source" data-source={advice.source}>{advice.source === 'llm' ? 'AI-phrased' : 'Standard'}</span>
            {advice.pending && <span> · Preparing voice advice…</span>}
            {advice.voice === 'speaking' && <span role="status"> · Speaking…</span>}
          </p>
          <div className="rr-actions rr-voice">
            {advice.speaking ? (
              <button className="rr-btn" onClick={advice.stop}>Stop</button>
            ) : (
              <button className="rr-btn" onClick={advice.play} disabled={advice.pending}>
                {advice.voice === 'blocked' || advice.voice === 'failed' || advice.voice === 'unsupported' || !profile.voiceOn
                  ? 'Play advice'
                  : 'Play again'}
              </button>
            )}
          </div>
          {advice.voice === 'blocked' && (
            <p className="rr-note" role="note">Your browser blocked automatic voice until you interact with the page. Press “Play advice”.</p>
          )}
          {advice.voice === 'failed' && <p className="rr-field-error" role="alert">The voice could not play. Check the volume and that the tab is not muted.</p>}
          {advice.voice === 'unsupported' && <p className="rr-note" role="note">This browser can&apos;t speak. Use Chrome or Edge for voice advice; the text above is the same advice.</p>}
        </section>

        <section className="rr-card" aria-labelledby="cmp-h">
          <h2 id="cmp-h">Compare routes</h2>
          {route.identical_routes && <p className="rr-muted">Both routes are the same, so there is nothing to avoid.</p>}
          <div className="rr-table-wrap">
            <table className="rr-compare">
              <caption className="rr-visually-hidden">Usual route compared with the RouteRain route</caption>
              <thead>
                <tr><th scope="col"><span className="rr-visually-hidden">Measure</span></th><th scope="col">Usual route</th><th scope="col">RouteRain route</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}><th scope="row">{r.label}</th><td>{r.usual}</td><td>{r.routerain}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="rr-effect" data-positive={effect.positive}>
            <b>{effect.label}:</b> {effect.value}
          </p>
          <p className="rr-muted rr-fine">
            Drive times are free-flow estimates without traffic. The flood-risk part is an estimate built on an assumed
            {' '}{route.flood_delay_min} minute delay if a hotspot floods. <Link to="/about">How this works</Link>
          </p>
        </section>

        {(why.length > 0 || route.still_passes_through.length > 0) && (
          <section className="rr-card" aria-labelledby="why-h">
            <h2 id="why-h">Why</h2>
            <ul className="rr-why">
              {why.map((h) => (
                <li key={h.id}>
                  <span className={`rr-tier ${h.tier}`}><span aria-hidden="true">{tierInfo(h.tier).glyph}</span> {tierInfo(h.tier).word}</span>{' '}
                  <b>Avoided {h.name}.</b> {h.explanation}
                </li>
              ))}
              {route.still_passes_through.map((h) => (
                <li key={h.id}>
                  <span className={`rr-tier ${h.tier}`}><span aria-hidden="true">{tierInfo(h.tier).glyph}</span> {tierInfo(h.tier).word}</span>{' '}
                  <b>Still passes near {h.name}.</b> No other road avoids it. {h.explanation}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="rr-actions">
          <Link to="/plan" className="rr-btn primary">Plan another trip</Link>
          <Link to="/" className="rr-btn">Back to the map</Link>
        </div>
      </div>

      <div className="rr-result-map">
        <RouteMap route={route} />
        <ul className="rr-legend" aria-label="Map legend">
          {!route.identical_routes && <li><span className="rr-swatch usual" aria-hidden="true" /> Usual route (grey, dashed)</li>}
          <li><span className="rr-swatch blue" aria-hidden="true" /> {route.identical_routes ? 'Both routes (blue)' : 'RouteRain route (blue)'}</li>
          {route.risk_zones.some((z) => z.tier === 'RED') && <li><span className="rr-swatch RED" aria-hidden="true" /> ✕ RED zone ({route.risk_zones.find((z) => z.tier === 'RED')?.radius_m} m)</li>}
          {route.risk_zones.some((z) => z.tier === 'YELLOW') && <li><span className="rr-swatch YELLOW" aria-hidden="true" /> ! YELLOW zone ({route.risk_zones.find((z) => z.tier === 'YELLOW')?.radius_m} m)</li>}
        </ul>
      </div>
    </div>
  );
}
