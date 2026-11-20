import React, { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';

type Risk = {
  hotspot_id: string; name: string; tier: string; probability: number;
  lat: number; lon: number; explanation: string; date: string;
  features: Record<string, number>; flooded?: boolean;
};
type Dashboard = { hotspots: Risk[]; fetched_at: string; tiers: Record<string, number> };
type HistoricalScenario = {
  date: string; hotspots: Risk[]; tiers: Record<string, number>;
  locations: number; flood_reports: number;
};
type Route = { coordinates: [number, number][]; length_m: number; time_s: number };
type RouteData = {
  origin: { label: string; lat: number; lon: number };
  destination: { label: string; lat: number; lon: number };
  normal_route: Route; flood_aware_route: Route; explanation: string;
};

const colors: Record<string, string> = { GREEN: '#5ce0a0', YELLOW: '#ffca68', RED: '#ff667c' };
const center: LatLngExpression = [28.4595, 77.0266];
const fmt = (n: number) => `${n.toFixed(5)}°`;

function MapClick({ onPick }: { onPick: (point: [number, number]) => void }) {
  useMapEvents({ click: e => onPick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

function MapFocus({ route, target }: { route: RouteData | null; target: LatLngExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (route) {
      const points = [...route.normal_route.coordinates, ...route.flood_aware_route.coordinates];
      if (points.length) map.fitBounds(points, { padding: [45, 45], maxZoom: 14 });
    } else if (target) map.flyTo(target, 14, { duration: 0.55 });
  }, [map, route, target]);
  return null;
}

function App() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Risk | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const [history, setHistory] = useState<HistoricalScenario[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [eventKey, setEventKey] = useState('');
  const [filters, setFilters] = useState<Record<string, boolean>>({ GREEN: true, YELLOW: true, RED: true });
  const [coords, setCoords] = useState<[number, number]>([28.4595, 77.0266]);

  const refresh = async () => {
    try {
      setError('');
      const response = await fetch('/api/dashboard');
      const body = await response.json().catch(() => null);
      if (!response.ok) throw Error(body?.detail || `Forecast API returned HTTP ${response.status}`);
      if (!body) throw Error('Forecast API returned an unreadable response.');
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Service unavailable');
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 600000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!demo || historyLoaded) return;
    setHistoryLoading(true);
    fetch('/api/history')
      .then(async response => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw Error(body?.detail || `History API returned HTTP ${response.status}`);
        setHistory(body?.scenarios ?? []);
        setHistoryLoaded(true);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Historical replay unavailable'))
      .finally(() => setHistoryLoading(false));
  }, [demo, historyLoaded]);

  const recommendedScenario = history.find(scenario => scenario.date === '2024-09-06') ?? history[0];
  useEffect(() => {
    if (!demo || !historyLoaded || eventKey || !recommendedScenario) return;
    setEventKey(recommendedScenario.date);
    if (recommendedScenario.date === '2024-09-06') {
      setOrigin('Bilaspur Chowk');
      setDestination('IFFCO Chowk');
    }
  }, [demo, historyLoaded, eventKey, recommendedScenario]);

  const activeScenario = demo ? history.find(scenario => scenario.date === eventKey) : undefined;
  const displayed = useMemo(() => activeScenario?.hotspots ?? data?.hotspots ?? [], [activeScenario, data]);
  const visible = displayed.filter(hotspot => filters[hotspot.tier]);
  const counts = activeScenario?.tiers ?? data?.tiers ?? {};

  async function findRoute(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setRoute(null);
    setError('');
    try {
      const response = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination, scenario_date: demo ? eventKey : null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw Error(body?.detail || `Route API returned HTTP ${response.status}`);
      if (!body) throw Error('Route API returned an unreadable response.');
      setRoute(body);
      setCoords([body.origin.lat, body.origin.lon]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not calculate route');
    } finally {
      setBusy(false);
    }
  }

  const picked = selected;

  return <div className="app-shell">
    <aside className="rail"><div className="brand-mark">R<span>↗</span></div><div className="rail-line"/><div className="rail-glyph active">◉</div><div className="rail-glyph">⌖</div><div className="rail-bottom">IN</div></aside>
    <main className="main">
      <header className="topbar">
        <div className="brand"><span className="brand-icon">R</span><span>Route<span className="brand-accent">Rain</span></span><span className="beta">FIELD INTELLIGENCE</span></div>
        <div className="top-meta"><span className="live-pill"><i/> {activeScenario ? 'HISTORICAL REPLAY' : 'LIVE FORECAST'}</span><span className="meta-divider"/><span>GURUGRAM · NCR</span><button className="icon-btn" aria-label="Refresh forecast" onClick={refresh}>↻</button></div>
      </header>

      <section className="intro">
        <div><div className="eyebrow"><span className="eyebrow-rule"/> MONSOON OPERATIONS / 01</div><h1>Know the road<br/><em>before the rain.</em></h1><p>Hyperlocal waterlogging intelligence for a safer journey across Gurugram.</p></div>
        <div className="intro-stamp"><span>FIELD STATUS</span><strong>{error ? 'DEGRADED' : data ? 'OPERATIONAL' : 'CONNECTING'}</strong><small><i className={error ? 'offline' : ''}/> {data ? `Updated ${new Date(data.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Connecting to forecast'}</small></div>
      </section>

      {error && <div className="error-banner"><span>!</span><div><b>Service notice</b><small>{error}</small></div><button onClick={refresh}>Retry ↗</button></div>}

      <section className="stats-row">
        <div className="stat-label">{activeScenario ? 'HISTORICAL EXPOSURE' : 'TODAY’S EXPOSURE'}</div>
        {(['RED', 'YELLOW', 'GREEN'] as const).map(tier => <button key={tier} className={`stat-card ${tier.toLowerCase()}`} onClick={() => setFilters(current => ({ ...current, [tier]: !current[tier] }))}>
          <span className="stat-dot"/><span className="stat-number">{counts[tier] ?? '—'}</span><span className="stat-tier">{tier}</span><span className="stat-desc">{tier === 'RED' ? 'Avoid if possible' : tier === 'YELLOW' ? 'Use caution' : 'Lower risk'}</span><span className={`toggle ${filters[tier] ? 'checked' : ''}`}/>
        </button>)}
        <div className="stat-foot">{displayed.length} monitored locations <span>·</span> {activeScenario ? `REPLAY · ${activeScenario.date}` : demo ? 'SELECT A HISTORICAL DAY' : '7 DAY FORECAST'}</div>
      </section>

      <div className="workspace">
        <section className="map-column">
          <div className="section-head">
            <div><span className="section-kicker">{activeScenario ? 'HISTORICAL SCENARIO MAP' : 'LIVE SITUATIONAL MAP'}</span><h2>Risk overview <span className="count-tag">{visible.length} SITES</span></h2></div>
            <div className="map-actions">
              <label className="replay-toggle"><input type="checkbox" checked={demo} onChange={e => { setDemo(e.target.checked); setEventKey(''); setSelected(null); setRoute(null); }}/><span className="switch"/><span>Replay a real flood day</span></label>
              {demo && <select className="event-select" value={eventKey} onChange={e => { setEventKey(e.target.value); setSelected(null); setRoute(null); }}>
                <option value="">{historyLoading ? 'Scoring historical days…' : 'Choose a high-risk day…'}</option>
                {history.map(scenario => <option key={scenario.date} value={scenario.date}>{scenario.date === recommendedScenario?.date ? '★ ROUTE DEMO · ' : ''}{scenario.date} · {scenario.tiers.RED} RED / {scenario.tiers.YELLOW} YELLOW · {scenario.flood_reports} reports</option>)}
              </select>}
            </div>
          </div>

          <div className="map-frame">
            <MapContainer center={center} zoom={12} scrollWheelZoom className="leaflet-map">
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
              <MapClick onPick={point => { setCoords(point); setSelected(null); }}/>
              <MapFocus route={route} target={selected ? [selected.lat, selected.lon] : null}/>
              {visible.map(hotspot => <CircleMarker key={hotspot.hotspot_id} center={[hotspot.lat, hotspot.lon]} radius={selected?.hotspot_id === hotspot.hotspot_id ? 11 : 8} pathOptions={{ color: colors[hotspot.tier], fillColor: colors[hotspot.tier], fillOpacity: .9, weight: 2 }} eventHandlers={{ click: () => { setSelected(hotspot); setCoords([hotspot.lat, hotspot.lon]); } }}>
                <Popup><b>{hotspot.name} · {hotspot.tier}</b><br/>{hotspot.explanation}</Popup>
              </CircleMarker>)}
              {route && <><Polyline positions={route.normal_route.coordinates} pathOptions={{ color: '#9aa5b1', weight: 4, dashArray: '9 9', opacity: .7 }}/><Polyline positions={route.flood_aware_route.coordinates} pathOptions={{ color: '#5ed6ff', weight: 5, opacity: .95 }}/></>}
            </MapContainer>
            <div className="map-crosshair">⌖</div><div className="map-tag"><i/> {activeScenario ? `REPLAY ${activeScenario.date}` : 'MONSOON WATCH'} <span>·</span> NCR</div>
            <div className="map-legend"><div><i className="legend-dot red"/> RED <small>AVOID</small></div><div><i className="legend-dot yellow"/> YELLOW <small>CAUTION</small></div><div><i className="legend-dot green"/> GREEN <small>LOWER</small></div>{route && <><div><i className="route-line normal"/> STANDARD</div><div><i className="route-line safe"/> FLOOD-AWARE</div></>}</div>
          </div>

          <div className="coordinate-bar"><div className="coord-icon">⌖</div><div className="coord-label">MAP COORDINATES <small>{picked ? picked.name : 'Selected map point'}</small></div><div className="coord-value"><span>LAT</span>{fmt(coords[0])}</div><div className="coord-value"><span>LON</span>{fmt(coords[1])}</div><button className="copy-coord" title="Copy coordinates" onClick={() => navigator.clipboard?.writeText(`${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`)}>COPY ↗</button></div>

          {activeScenario && <div className="replay-note">Historical replay · {activeScenario.date}. {activeScenario.locations} locations with recorded weather, {activeScenario.flood_reports} reported flood events. Every tier is scored by the deployed model; the reroute planner uses these historical tiers.</div>}
          {route && <div className="route-result"><div className="route-result-top"><span className="section-kicker">ROUTE ADVISORY</span><button onClick={() => setRoute(null)} aria-label="Clear route">×</button></div><p>{route.explanation}</p><div className="route-metrics">{([['STANDARD ROUTE', route.normal_route], ['FLOOD-AWARE', route.flood_aware_route]] as [string, Route][]).map(([label, r]) => <div key={label}><small>{label}</small><strong>{(r.length_m / 1000).toFixed(1)} <em>km</em></strong><span>{(r.time_s / 60).toFixed(0)} min estimated</span></div>)}</div><div className="route-delta">DETOUR COST <b>+{((route.flood_aware_route.length_m - route.normal_route.length_m) / 1000).toFixed(1)} km</b><b>+{((route.flood_aware_route.time_s - route.normal_route.time_s) / 60).toFixed(0)} min</b></div></div>}
          <div className="caveat"><span>i</span><p><b>Decision support, not a guarantee.</b> Model estimates use limited historical flood reports. Always use your judgment during heavy rain.</p></div>
        </section>

        <aside className="side-panel">
          <div className="panel-head"><div><span className="section-kicker">PRIORITY LOCATIONS</span><h2>Hotspot watch</h2></div><span className="panel-count">{visible.length.toString().padStart(2, '0')}</span></div>
          <div className="hotspot-list">{visible.map((hotspot, index) => <button key={hotspot.hotspot_id} className={`hotspot ${selected?.hotspot_id === hotspot.hotspot_id ? 'selected' : ''}`} onClick={() => { setSelected(hotspot); setCoords([hotspot.lat, hotspot.lon]); }}>
            <span className={`rank ${hotspot.tier.toLowerCase()}`}>{String(index + 1).padStart(2, '0')}</span><span className="hotspot-content"><span className="hotspot-top"><b>{hotspot.name}</b><span className={`tier-badge ${hotspot.tier.toLowerCase()}`}>{hotspot.tier}</span></span><span className="hotspot-reason">{hotspot.explanation}</span><span className="risk-meter"><i style={{ width: `${Math.max(3, hotspot.probability * 100)}%`, background: colors[hotspot.tier] }}/></span><span className="hotspot-foot"><span>{Math.round(hotspot.probability * 100)}% EST. RISK</span><span>{hotspot.hotspot_id} ↗</span></span></span>
          </button>)}{!visible.length && <div className="empty-state">{demo && historyLoading ? 'Scoring real historical flood days…' : 'No locations match these filters.'}</div>}</div>
          <form className="route-card" onSubmit={findRoute}><div className="route-card-head"><span className="route-icon">↗</span><div><span className="section-kicker">GET THERE SAFER</span><h3>Plan a route</h3></div></div>
            <label>FROM<input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="e.g. Sector 29, Gurugram" maxLength={120} required/></label><div className="route-connector"/><label>TO<input value={destination} onChange={e => setDestination(e.target.value)} placeholder="e.g. Cyber City, Gurugram" maxLength={120} required/></label>
            <button className="route-submit" disabled={busy || (demo && !eventKey)}>{busy ? 'Finding safer route…' : demo && !eventKey ? 'Select a replay day first' : 'Compare routes'} <span>↗</span></button><small className="route-note">{activeScenario?.date === '2024-09-06' ? 'Demo route prefilled: avoids three historical risk zones.' : activeScenario ? `Routing uses ${activeScenario.date} historical RED/YELLOW zones.` : 'Routes account for RED and YELLOW hotspot zones.'}</small>
          </form>
        </aside>
      </div>
      <footer><span>© ROUTERAIN <i>·</i> GURUGRAM, INDIA</span><span>BUILT FOR THE MONSOON <b>✳</b></span></footer>
    </main>
  </div>;
}

export default App;
