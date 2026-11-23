import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet';

import type { Hotspot } from '@/api/schemas';
import { GURUGRAM_CENTER } from '@/theme';

import { markerSpec } from './markers';

// The icon HTML is built only from constants (tier glyph/word/class), never from API text, so it cannot inject markup.
function makeIcon(h: Hotspot, selected: boolean) {
  const s = markerSpec(h);
  return L.divIcon({
    className: 'rr-marker-wrap',
    html: `<div class="rr-marker ${s.tier}${selected ? ' selected' : ''}"><span aria-hidden="true">${s.glyph}</span> ${s.word}</div>`,
    iconSize: [0, 0],
  });
}

const CORE_RADIUS_KM = 15;

const km = (a: [number, number], b: [number, number]) => {
  const p = Math.PI / 180;
  const h = Math.sin(((b[0] - a[0]) * p) / 2) ** 2 + Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin(((b[1] - a[1]) * p) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Hotspots near the middle of the group (the dense city core) and any far-away outliers (e.g. Bilaspur Chowk). */
export function splitCore(hotspots: Hotspot[]): { core: Hotspot[]; outside: Hotspot[] } {
  if (hotspots.length < 3) return { core: hotspots, outside: [] };
  const mid: [number, number] = [median(hotspots.map((h) => h.lat)), median(hotspots.map((h) => h.lon))];
  const core = hotspots.filter((h) => km(mid, [h.lat, h.lon]) <= CORE_RADIUS_KM);
  return { core, outside: hotspots.filter((h) => !core.includes(h)) };
}

function Focus({ hotspots, selected }: { hotspots: Hotspot[]; selected: Hotspot | null }) {
  const map = useMap();
  // Fit the dense core once when the set changes (so labels don't pile up); fly to the selected one when it changes.
  const key = hotspots.map((h) => h.id).join(',');
  useEffect(() => {
    const { core } = splitCore(hotspots);
    if (core.length) map.fitBounds(core.map((h) => [h.lat, h.lon] as [number, number]), { padding: [60, 60], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  useEffect(() => {
    if (selected) map.flyTo([selected.lat, selected.lon], Math.max(map.getZoom(), 13), { duration: 0.5 });
  }, [map, selected]);
  return null;
}

type Props = {
  hotspots: Hotspot[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Shown over the map while hotspots load. */
  loading?: boolean;
};

export function HotspotMap({ hotspots, selectedId, onSelect, loading }: Props) {
  const [map, setMap] = useState<L.Map | null>(null);
  const { outside } = useMemo(() => splitCore(hotspots), [hotspots]);
  const selected = hotspots.find((h) => h.id === selectedId) ?? null;
  const icons = useMemo(
    () => new Map(hotspots.map((h) => [h.id, makeIcon(h, h.id === selectedId)])),
    [hotspots, selectedId],
  );
  return (
    <div className="rr-map" data-testid="hotspot-map">
      <MapContainer ref={setMap} center={GURUGRAM_CENTER} zoom={12} scrollWheelZoom className="rr-map-inner" aria-label="Map of Gurugram flood hotspots">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Focus hotspots={hotspots} selected={selected} />
        {hotspots.map((h) => {
          const s = markerSpec(h);
          return (
            <Marker
              key={h.id}
              position={[h.lat, h.lon]}
              icon={icons.get(h.id)}
              title={s.ariaLabel}
              alt={s.ariaLabel}
              keyboard
              eventHandlers={{ click: () => onSelect(h.id) }}>
              <Tooltip direction="bottom" offset={[0, 16]} permanent={h.id === selectedId}>{h.name}</Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
      {loading && <div className="rr-map-overlay" role="status">Loading hotspots…</div>}
      {outside.length > 0 && (
        <div className="rr-map-overlay rr-outside" role="status">
          {outside.length === 1 ? '1 hotspot is' : `${outside.length} hotspots are`} outside this view:{' '}
          {outside.map((h) => `${h.name} (${markerSpec(h).word})`).join(', ')}.{' '}
          <button
            type="button"
            className="rr-link"
            onClick={() => map?.fitBounds(hotspots.map((h) => [h.lat, h.lon] as [number, number]), { padding: [50, 50] })}>
            Show all
          </button>
        </div>
      )}
    </div>
  );
}
