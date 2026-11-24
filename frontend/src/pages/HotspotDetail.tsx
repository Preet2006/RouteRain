import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { ApiError, getHotspotDetail } from '@/api/client';
import { HotspotDetailMap } from '@/features/hotspots/HotspotDetailMap';
import { probabilityBand } from '@/features/hotspots/markers';
import { areaLabel, conditionRows, historyText, reportedText, sinkText } from '@/features/hotspots/model';
import { replayDateLabel } from '@/lib/dates';
import { useScenario } from '@/lib/scenario';
import { tierInfo } from '@/theme';

/** Full-screen detail for one hotspot: a street-level map with its risk zone, and a docked panel of facts. */
export function HotspotDetail() {
  const { id = '' } = useParams();
  const { scenario } = useScenario();
  const replay = scenario.mode === 'replay';
  const { data, error, isPending } = useQuery({
    queryKey: ['hotspot-detail', id, scenario.mode, scenario.date],
    queryFn: () => getHotspotDetail(id, scenario.mode, scenario.date),
    retry: false,
    staleTime: scenario.mode === 'live' ? 10 * 60_000 : Infinity,
  });

  if (isPending) {
    return (
      <div className="rr-text">
        <h1>Loading hotspot…</h1>
        <div className="rr-skeleton" aria-busy="true" style={{ width: '40%' }} />
        <div className="rr-skeleton" style={{ width: '60%' }} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rr-text">
        <h1>Hotspot</h1>
        <div className="rr-error" role="alert">
          <b>{error instanceof ApiError ? error.message : "Can't reach the RouteRain server."}</b>
          <p><Link to="/hotspots">Back to all hotspots</Link></p>
        </div>
      </div>
    );
  }

  const h = data.hotspot;
  const t = tierInfo(h.tier);
  const band = probabilityBand(h.probability);
  const conditions = conditionRows(data.conditions);
  const terrain = data.terrain;
  const infra = data.infrastructure;

  return (
    <div className="rr-detail">
      <aside className="rr-detail-panel" aria-label={`${h.name} details`}>
        <Link to={`/hotspots${replay ? `?replay=${scenario.date}` : ''}`} className="rr-backlink">← All hotspots</Link>
        <h1>{h.name}</h1>
        {areaLabel(h.type) && <p className="rr-muted rr-hcard-area">{areaLabel(h.type)}</p>}
        <p><span className={`rr-tier ${h.tier}`}><span aria-hidden="true">{t.glyph}</span> {t.label}</span></p>

        {replay && (
          <p className="rr-banner" role="status">
            <b>Replay: {replayDateLabel(scenario.date)} weather.</b> This is a past day, not today&apos;s forecast.
          </p>
        )}

        <p>{h.explanation}</p>
        <ul className="rr-rows">
          <li><span>Estimated risk</span><span>{band ? `about ${band}` : 'Not scored'}</span></li>
          <li><span>Risk zone for routing</span><span>{data.buffer_m} m</span></li>
          <li><span>Location</span><span>{h.lat.toFixed(5)}, {h.lon.toFixed(5)}</span></li>
        </ul>

        {replay && (
          <p className="rr-reported">
            <b>Reported that day:</b> {reportedText(h)}
            <small className="rr-muted"> This is what was recorded, separate from the prediction above.</small>
          </p>
        )}

        <section aria-labelledby="d-cond">
          <h2 id="d-cond">{replay ? 'Conditions that day' : 'Conditions in the forecast'}</h2>
          {conditions ? (
            <ul className="rr-rows">
              {conditions.map((r) => (
                <li key={r.label}><span>{r.label}</span><span>{r.value}</span></li>
              ))}
            </ul>
          ) : (
            <p className="rr-muted">Not scored: rain at this spot was under 10 mm, below what the model scores.</p>
          )}
        </section>

        <section aria-labelledby="d-terrain">
          <h2 id="d-terrain">The ground here</h2>
          <ul className="rr-rows">
            <li><span>Elevation</span><span>{Math.round(terrain.elevation_m)} m</span></li>
            <li><span>Position</span><span>{sinkText(terrain.sink_depth_m)}</span></li>
          </ul>
          <p className="rr-muted rr-fine">From a 30 m elevation model, so small dips and drains are not visible in it.</p>
        </section>

        <section aria-labelledby="d-hist">
          <h2 id="d-hist">Past floods</h2>
          <p>{historyText(data.history)}</p>
          <p className="rr-muted rr-fine">From news and social-media reports. Small floods go unreported, so this is a minimum.</p>
        </section>

        <section aria-labelledby="d-infra">
          <h2 id="d-infra">Infrastructure</h2>
          {infra.flagged ? (
            <>
              <p>{infra.note}</p>
              {infra.evidence_date && <p className="rr-muted rr-fine">Reported {replayDateLabel(infra.evidence_date)}.</p>}
              {infra.source_url && (
                <p><a href={infra.source_url} target="_blank" rel="noopener noreferrer">Read the source report</a></p>
              )}
            </>
          ) : (
            <p className="rr-muted">{infra.note ?? 'No specific infrastructure defect found in the collected sources.'}</p>
          )}
        </section>

        <div className="rr-actions rr-detail-actions">
          <Link to="/plan" className="rr-btn primary">Plan a trip avoiding this</Link>
          <Link to={`/hotspots${replay ? `?replay=${scenario.date}` : ''}`} className="rr-btn">Back to all hotspots</Link>
        </div>
      </aside>

      <div className="rr-detail-mapwrap">
        <HotspotDetailMap hotspot={h} bufferM={data.buffer_m} />
      </div>
    </div>
  );
}
