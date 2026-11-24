import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { Marker, Tooltip } from 'react-leaflet';

import type { Hotspot } from '@/api/schemas';
import { markerSpec } from '@/features/hotspots/markers';

// Constant markup only (the tier class), never API text.
const dotIcon = (tier: string) =>
  L.divIcon({ className: 'rr-marker-wrap', html: `<div class="rr-dot ${tier}"></div>`, iconSize: [0, 0] });

function Dot({ hotspot }: { hotspot: Hotspot }) {
  const ref = useRef<L.Marker | null>(null);
  const spec = markerSpec(hotspot);

  // Leaflet opens tooltips on hover only; also open it when the dot is focused with the keyboard.
  useEffect(() => {
    const marker = ref.current;
    const el = marker?.getElement();
    if (!marker || !el) return;
    const open = () => marker.openTooltip();
    const close = () => marker.closeTooltip();
    el.addEventListener('focus', open);
    el.addEventListener('blur', close);
    return () => {
      el.removeEventListener('focus', open);
      el.removeEventListener('blur', close);
    };
  }, []);

  return (
    <Marker ref={ref} position={[hotspot.lat, hotspot.lon]} icon={dotIcon(hotspot.tier)} title={spec.ariaLabel} alt={spec.ariaLabel} keyboard>
      <Tooltip direction="top" offset={[0, -8]}>{hotspot.name}: {spec.word}</Tooltip>
    </Marker>
  );
}

/** Small tier-coloured dots, one per hotspot; the name and tier word show on hover or keyboard focus. */
export function HotspotDots({ hotspots }: { hotspots: Hotspot[] }) {
  return (
    <>
      {hotspots.map((h) => (
        <Dot key={`${h.id}-${h.tier}`} hotspot={h} />
      ))}
    </>
  );
}
