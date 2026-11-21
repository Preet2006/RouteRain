import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';

import type { SavedPlace } from '@/lib/storage';
import { GURUGRAM_CENTER } from '@/theme';

export type PickTarget = 'from' | 'to' | null;

// Icon HTML is constant text only (a letter), never user input.
const pin = (letter: 'A' | 'B') =>
  L.divIcon({ className: 'rr-marker-wrap', html: `<div class="rr-pin ${letter}">${letter}</div>`, iconSize: [0, 0] });
const A = pin('A');
const B = pin('B');

function Clicks({ target, onPick }: { target: PickTarget; onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => target && onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Fit({ from, to }: { from: SavedPlace | null; to: SavedPlace | null }) {
  const map = useMap();
  useEffect(() => {
    const pts = [from, to].filter((p): p is SavedPlace => p !== null).map((p) => [p.lat, p.lon] as [number, number]);
    if (pts.length === 2) map.fitBounds(pts, { padding: [70, 70], maxZoom: 14 });
    else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 13));
  }, [map, from, to]);
  return null;
}

type Props = { from: SavedPlace | null; to: SavedPlace | null; picking: PickTarget; onPick: (lat: number, lon: number) => void };

/** Small map for trip planning: shows pins A and B, and while "Pick on map" is on, a click sets the point. */
export function PickMap({ from, to, picking, onPick }: Props) {
  return (
    <div className={`rr-map rr-plan-map${picking ? ' picking' : ''}`} data-testid="pick-map">
      <MapContainer center={GURUGRAM_CENTER} zoom={11} scrollWheelZoom className="rr-map-inner" aria-label="Map for choosing pickup and drop points">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Clicks target={picking} onPick={onPick} />
        <Fit from={from} to={to} />
        {from && <Marker position={[from.lat, from.lon]} icon={A} title={`Pickup: ${from.label}`} alt="Pickup point" />}
        {to && <Marker position={[to.lat, to.lon]} icon={B} title={`Drop: ${to.label}`} alt="Drop point" />}
      </MapContainer>
      {picking && (
        <div className="rr-map-overlay rr-pick-hint" role="status">
          Click the map to set the {picking === 'from' ? 'pickup (A)' : 'drop (B)'} point.
        </div>
      )}
    </div>
  );
}
