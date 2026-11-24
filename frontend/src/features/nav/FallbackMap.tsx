import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { tierInfo } from '@/theme';

import { drivenLine } from './geo';
import { CAR_COLOR, DRIVEN_GREY, ROUTE_BLUE, type NavMapHandle, type NavMapProps } from './mapTypes';

const DRIVEN_UPDATE_MS = 250;
const ZOOM = 16;

const carIcon = () =>
  L.divIcon({
    className: 'rr-marker-wrap',
    iconSize: [0, 0],
    html: `<div class="rr-car"><svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true" focusable="false" style="transform:translate(-22px,-22px)"><circle cx="20" cy="20" r="17" fill="#fff" opacity=".95"/><path d="M20 6 L30 31 L20 25 L10 31 Z" fill="${CAR_COLOR}" stroke="#0b1d3a" stroke-width="1.5" stroke-linejoin="round"/></svg></div>`,
  });

/**
 * The fallback navigation map (Leaflet, OpenStreetMap tiles, north-up): used when the vector map cannot start. The
 * car icon is rotated to the direction of travel instead of the map turning.
 */
export const FallbackNavMap = forwardRef<NavMapHandle, NavMapProps>(function FallbackNavMap({ route, directions, onDragged }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<NavMapHandle>({ update() {}, recenter() {} });
  const dragged = useRef(onDragged);
  dragged.current = onDragged;
  useImperativeHandle(ref, () => ({ update: (f, n) => api.current.update(f, n), recenter: () => api.current.recenter() }), []);

  useEffect(() => {
    const g = directions.geometry;
    const map = L.map(box.current!, { zoomControl: true, attributionControl: true, zoomAnimation: false, fadeAnimation: false }).setView(
      g.coordinates[0] as [number, number],
      ZOOM,
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    route.risk_zones.forEach((z) => {
      const t = tierInfo(z.tier);
      L.circle([z.lat, z.lon], { radius: z.radius_m, color: t.color, fillColor: t.color, fillOpacity: 0.2, weight: 2 }).addTo(map);
    });
    L.polyline(g.coordinates as [number, number][], { color: ROUTE_BLUE, weight: 7, opacity: 0.95 }).addTo(map);
    const driven = L.polyline([], { color: DRIVEN_GREY, weight: 7, opacity: 0.95 }).addTo(map);
    const dest = g.coordinates[g.coordinates.length - 1];
    L.marker(dest as [number, number], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: 'rr-marker-wrap', html: '<div class="rr-pin B"><span>B</span></div>', iconSize: [0, 0] }),
    }).addTo(map);
    const car = L.marker(g.coordinates[0] as [number, number], { icon: carIcon(), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);

    const s = { following: true, lastDriven: 0 };
    map.on('dragstart', () => {
      s.following = false;
      dragged.current();
    });
    api.current = {
      update(frame, now) {
        car.setLatLng([frame.lat, frame.lon]);
        const ds = box.current?.dataset;
        if (ds) {
          ds.lat = frame.lat.toFixed(7);
          ds.lon = frame.lon.toFixed(7);
          ds.heading = frame.heading.toFixed(1);
        }
        const el = car.getElement()?.firstElementChild as HTMLElement | null;
        if (el) el.style.transform = `rotate(${frame.heading}deg)`;
        if (now - s.lastDriven > DRIVEN_UPDATE_MS) {
          s.lastDriven = now;
          driven.setLatLngs(drivenLine(g, frame.distanceM) as [number, number][]);
        }
        if (s.following) map.setView([frame.lat, frame.lon], ZOOM, { animate: false });
      },
      recenter() {
        s.following = true;
      },
    };
    return () => {
      api.current = { update() {}, recenter() {} };
      map.remove();
    };
  }, [directions, route]);

  return <div ref={box} className="rr-drive-canvas" data-testid="nav-map" data-engine="leaflet" role="region" aria-label="Navigation map (north up)" />;
});
