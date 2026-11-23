import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { Circle, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';

import type { RouteResponse } from '@/api/schemas';
import { colors, GURUGRAM_CENTER, tierInfo } from '@/theme';

const pin = (letter: 'A' | 'B') =>
  L.divIcon({ className: 'rr-marker-wrap', html: `<div class="rr-pin ${letter}"><span>${letter}</span></div>`, iconSize: [0, 0] });
const A = pin('A');
const B = pin('B');

function Fit({ route }: { route: RouteResponse }) {
  const map = useMap();
  useEffect(() => {
    const pts = [...route.normal_route.polyline, ...route.flood_aware_route.polyline];
    if (pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 14 });
  }, [map, route]);
  return null;
}

/**
 * Usual route (grey, dashed) under the RouteRain route (solid blue), the RED/YELLOW risk zones as translucent
 * circles of their real buffer radius, and pins A and B. When the routes are identical only one line is drawn.
 */
export function RouteMap({ route }: { route: RouteResponse }) {
  return (
    <div className="rr-map rr-route-map" data-testid="route-map">
      <MapContainer center={GURUGRAM_CENTER} zoom={12} scrollWheelZoom className="rr-map-inner" aria-label="Map of the usual route and the RouteRain route">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Fit route={route} />
        {route.risk_zones.map((z) => {
          const t = tierInfo(z.tier);
          return (
            <Circle
              key={z.id}
              center={[z.lat, z.lon]}
              radius={z.radius_m}
              pathOptions={{ color: t.color, fillColor: t.color, fillOpacity: 0.18, weight: 2 }}>
              <Tooltip sticky>{z.name}: {t.word}</Tooltip>
            </Circle>
          );
        })}
        {!route.identical_routes && (
          <Polyline positions={route.normal_route.polyline} pathOptions={{ color: '#9aa5b1', weight: 5, dashArray: '9 9', opacity: 0.85 }} />
        )}
        <Polyline positions={route.flood_aware_route.polyline} pathOptions={{ color: colors.accent, weight: 5, opacity: 0.95 }} />
        <Marker position={[route.origin.lat, route.origin.lon]} icon={A} title={`From: ${route.origin.label}`} alt="Start" />
        <Marker position={[route.destination.lat, route.destination.lon]} icon={B} title={`To: ${route.destination.label}`} alt="Destination" />
      </MapContainer>
    </div>
  );
}
