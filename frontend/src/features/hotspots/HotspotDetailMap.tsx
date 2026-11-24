import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Circle, MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet';

import type { Hotspot } from '@/api/schemas';
import { tierInfo } from '@/theme';

import { markerSpec } from './markers';

export const DETAIL_ZOOM = 16;

// Icon HTML is built from constants only (tier glyph and word), never from API text.
function icon(h: Hotspot) {
  const s = markerSpec(h);
  return L.divIcon({
    className: 'rr-marker-wrap',
    html: `<div class="rr-marker ${s.tier} selected"><span aria-hidden="true">${s.glyph}</span> ${s.word}</div>`,
    iconSize: [0, 0],
  });
}

/** Street-level map centred on the hotspot, with its risk-zone circle. The OSM tiles show the surrounding roads. */
export function HotspotDetailMap({ hotspot, bufferM }: { hotspot: Hotspot; bufferM: number }) {
  const t = tierInfo(hotspot.tier);
  const spec = markerSpec(hotspot);
  return (
    <div className="rr-map rr-detail-map" data-testid="detail-map" role="region" aria-label={`Street map around ${hotspot.name}`}>
      <MapContainer
        key={hotspot.id}
        center={[hotspot.lat, hotspot.lon]}
        zoom={DETAIL_ZOOM}
        scrollWheelZoom
        className="rr-map-inner"
       >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Circle
          center={[hotspot.lat, hotspot.lon]}
          radius={bufferM}
          pathOptions={{ color: t.color, fillColor: t.color, fillOpacity: 0.14, weight: 2, dashArray: '6 6' }}>
          <Tooltip sticky>{bufferM} m risk zone</Tooltip>
        </Circle>
        <Marker position={[hotspot.lat, hotspot.lon]} icon={icon(hotspot)} title={spec.ariaLabel} alt={spec.ariaLabel} keyboard />
      </MapContainer>
      <p className="rr-map-caption" role="note">
        Dashed circle: the {bufferM} m zone RouteRain steers routes away from when this spot is {hotspot.tier === 'RED' ? 'RED' : 'YELLOW'}.
      </p>
    </div>
  );
}
