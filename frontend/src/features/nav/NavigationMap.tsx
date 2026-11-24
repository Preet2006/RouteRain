import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its tile worker from a file: let Vite bundle it (with its own imports) and tell MapLibre where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { colors, tierInfo } from '@/theme';

import type { Frame } from './driveController';
import { circleRing, drivenLine, headingAt, type LatLon } from './geo';
import { smoothAngle } from './geo';
import { CAR_COLOR, DRIVEN_GREY, ROUTE_BLUE, ROUTE_CASING, type NavMapHandle, type NavMapProps } from './mapTypes';

maplibregl.setWorkerUrl(workerUrl);

/** OpenFreeMap: free vector tiles, no key, no registration. Attribution (OpenFreeMap, OpenMapTiles, OpenStreetMap) stays visible. */
export const NAV_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const STYLE_TIMEOUT_MS = 12_000;
const PITCH = 45;
const ZOOM = 16.6;
const ZOOM_IN = 17.4;
const DRIVEN_UPDATE_MS = 250;

const toLngLat = (pts: readonly LatLon[]) => pts.map(([lat, lon]) => [lon, lat]);

function carElement() {
  const el = document.createElement('div');
  el.className = 'rr-car';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Your car');
  el.innerHTML = `<svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="17" fill="#fff" opacity=".95"/><path d="M20 6 L30 31 L20 25 L10 31 Z" fill="${CAR_COLOR}" stroke="#0b1d3a" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  return el;
}

function destinationElement() {
  const el = document.createElement('div');
  el.className = 'rr-pin B';
  el.style.translate = '0 0';
  el.innerHTML = '<span>B</span>';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Destination');
  return el;
}

/**
 * The navigation map: MapLibre GL with OpenFreeMap tiles. Heading-up (the map turns so the direction of travel is
 * up), tilted about 45 degrees, following the car with eased bearing and zoom. If the style cannot load or WebGL is
 * unavailable it calls onFailed and the screen switches to the Leaflet fallback.
 */
export const NavigationMap = forwardRef<NavMapHandle, NavMapProps>(function NavigationMap({ route, directions, onDragged, onFailed }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<NavMapHandle>({ update() {}, recenter() {} });
  const cbs = useRef({ onDragged, onFailed });
  cbs.current = { onDragged, onFailed };
  useImperativeHandle(ref, () => ({ update: (f, n) => api.current.update(f, n), recenter: () => api.current.recenter() }), []);

  useEffect(() => {
    const g = directions.geometry;
    let map: maplibregl.Map | null = null;
    let failed = false;
    let loaded = false;
    const fail = (why: string) => {
      if (failed || loaded) return;
      failed = true;
      clearTimeout(timer);
      try {
        map?.remove();
      } catch {
        /* already gone */
      }
      map = null;
      cbs.current.onFailed?.(why);
    };
    const timer = setTimeout(() => fail('timeout'), STYLE_TIMEOUT_MS);

    try {
      map = new maplibregl.Map({
        container: box.current!,
        style: NAV_STYLE_URL,
        center: [g.coordinates[0][1], g.coordinates[0][0]],
        zoom: ZOOM,
        pitch: PITCH,
        bearing: headingAt(g, 0),
        maxPitch: 60,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: false,
        fadeDuration: 0,
      });
    } catch {
      fail('webgl');
      return () => clearTimeout(timer);
    }
    const m = map;
    m.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');

    const car = new maplibregl.Marker({ element: carElement(), rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat([g.coordinates[0][1], g.coordinates[0][0]])
      .addTo(m);
    const dest = g.coordinates[g.coordinates.length - 1];
    new maplibregl.Marker({ element: destinationElement(), anchor: 'bottom' }).setLngLat([dest[1], dest[0]]).addTo(m);

    const s = { following: true, bearing: headingAt(g, 0), zoom: ZOOM, lastNow: 0, lastDriven: 0, frame: null as Frame | null };

    m.on('error', () => {
      if (!loaded) fail('style');
    });
    m.on('dragstart', () => {
      s.following = false;
      cbs.current.onDragged();
    });
    m.on('load', () => {
      if (failed) return;
      loaded = true;
      clearTimeout(timer);
      m.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: toLngLat(g.coordinates) } } });
      m.addSource('driven', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: toLngLat(drivenLine(g, 0)) } } });
      m.addSource('zones', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: route.risk_zones.map((z) => ({
            type: 'Feature' as const,
            properties: { tier: z.tier, name: z.name },
            geometry: { type: 'Polygon' as const, coordinates: [circleRing(z.lat, z.lon, z.radius_m)] },
          })),
        },
      });
      const tierColor: maplibregl.ExpressionSpecification = ['match', ['get', 'tier'], 'RED', tierInfo('RED').color, 'YELLOW', tierInfo('YELLOW').color, colors.neutral];
      m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': tierColor, 'fill-opacity': 0.2 } });
      m.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': tierColor, 'line-width': 2, 'line-opacity': 0.8 } });
      const line = { 'line-join': 'round', 'line-cap': 'round' } as const;
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: line, paint: { 'line-color': ROUTE_CASING, 'line-width': 11, 'line-opacity': 0.9 } });
      m.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: line, paint: { 'line-color': ROUTE_BLUE, 'line-width': 7 } });
      m.addLayer({ id: 'driven-line', type: 'line', source: 'driven', layout: line, paint: { 'line-color': DRIVEN_GREY, 'line-width': 7 } });
      if (s.frame) api.current.update(s.frame, performance.now());
    });

    api.current = {
      update(frame, now) {
        s.frame = frame;
        car.setLngLat([frame.lon, frame.lat]).setRotation(frame.heading);
        const ds = box.current?.dataset;
        if (ds) {
          // live state for tests and the real-browser check (cheap string writes)
          ds.lat = frame.lat.toFixed(7);
          ds.lon = frame.lon.toFixed(7);
          ds.heading = frame.heading.toFixed(1);
          ds.bearing = s.bearing.toFixed(1);
          ds.zoom = s.zoom.toFixed(2);
          ds.following = String(s.following);
        }
        if (!loaded) return;
        const dt = s.lastNow ? Math.min(0.25, (now - s.lastNow) / 1000) : 0.016;
        s.lastNow = now;
        if (now - s.lastDriven > DRIVEN_UPDATE_MS) {
          s.lastDriven = now;
          (m.getSource('driven') as maplibregl.GeoJSONSource | undefined)?.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: toLngLat(drivenLine(g, frame.distanceM)) },
          });
        }
        if (!s.following) return;
        s.bearing = smoothAngle(s.bearing, frame.heading, 1 - Math.exp(-dt / 0.45));
        s.zoom += ((frame.zoomIn ? ZOOM_IN : ZOOM) - s.zoom) * (1 - Math.exp(-dt / 0.9));
        // the car sits in the lower part of the screen, so more of the road ahead is visible
        const top = Math.round(m.getContainer().clientHeight * 0.32);
        m.jumpTo({ center: [frame.lon, frame.lat], bearing: s.bearing, zoom: s.zoom, pitch: PITCH, padding: { top, bottom: 0, left: 0, right: 0 } });
      },
      recenter() {
        s.following = true;
        if (s.frame) api.current.update(s.frame, performance.now());
      },
    };

    return () => {
      clearTimeout(timer);
      api.current = { update() {}, recenter() {} };
      failed = true;
      try {
        m.remove();
      } catch {
        /* already gone */
      }
    };
  }, [directions, route]);

  return <div ref={box} className="rr-drive-canvas" data-testid="nav-map" data-engine="maplibre" role="region" aria-label="Navigation map" />;
});
