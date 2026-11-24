/** Small geometry helpers for the navigation screen. Coordinates are [lat, lon]; distances in metres; bearings in degrees clockwise from north. */

export type LatLon = readonly [number, number];
export type NavGeometry = { coordinates: readonly LatLon[]; cumulative_m: readonly number[] };

const EARTH_RADIUS_M = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LatLon, b: LatLon): number {
  const p1 = rad(a[0]);
  const p2 = rad(b[0]);
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a: LatLon, b: LatLon): number {
  const p1 = rad(a[0]);
  const p2 = rad(b[0]);
  const dl = rad(b[1] - a[1]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed shortest turn from `from` to `to`, -180..180 (positive = clockwise). */
export function angleDiff(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** Move `current` towards `target` along the shortest way by the fraction `alpha` (0..1). Result is 0..360. */
export function smoothAngle(current: number, target: number, alpha: number): number {
  return (current + angleDiff(current, target) * Math.max(0, Math.min(1, alpha)) + 360) % 360;
}

/** Index i of the segment [i, i+1] that contains distance d (clamped to the first / last segment). */
export function segmentAt(cumulative: readonly number[], d: number): number {
  const last = cumulative.length - 2;
  if (last < 0) return 0;
  if (d <= cumulative[0]) return 0;
  if (d >= cumulative[last + 1]) return last;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export type RoutePosition = { lat: number; lon: number; index: number; bearing: number };

/** The point at distance d along the route (clamped to its ends) and the bearing of the segment it is on. */
export function positionAt(g: NavGeometry, d: number): RoutePosition {
  const pts = g.coordinates;
  if (pts.length === 1) return { lat: pts[0][0], lon: pts[0][1], index: 0, bearing: 0 };
  const cum = g.cumulative_m;
  const clamped = Math.max(cum[0], Math.min(cum[cum.length - 1], d));
  const i = segmentAt(cum, clamped);
  const span = cum[i + 1] - cum[i];
  const f = span > 0 ? (clamped - cum[i]) / span : 0;
  const a = pts[i];
  const b = pts[i + 1];
  // a zero-length segment has no direction of its own: look for the nearest one that does
  let j = i;
  while (j > 0 && pts[j][0] === pts[j + 1][0] && pts[j][1] === pts[j + 1][1]) j--;
  let k = i;
  while (k < pts.length - 2 && pts[k][0] === pts[k + 1][0] && pts[k][1] === pts[k + 1][1]) k++;
  const useIdx = pts[i][0] !== pts[i + 1][0] || pts[i][1] !== pts[i + 1][1] ? i : pts[k][0] !== pts[k + 1][0] || pts[k][1] !== pts[k + 1][1] ? k : j;
  return {
    lat: a[0] + (b[0] - a[0]) * f,
    lon: a[1] + (b[1] - a[1]) * f,
    index: i,
    bearing: bearing(pts[useIdx], pts[useIdx + 1]),
  };
}

/**
 * Direction of travel at distance d, measured over `lookaheadM` so a tiny kink in the line does not make the map
 * (or the car) twitch. Near the end of the route it looks backwards instead.
 */
export function headingAt(g: NavGeometry, d: number, lookaheadM = 30): number {
  const total = g.cumulative_m[g.cumulative_m.length - 1];
  const from = Math.min(d, Math.max(0, total - lookaheadM));
  const a = positionAt(g, from);
  const b = positionAt(g, from + lookaheadM);
  if (a.lat === b.lat && a.lon === b.lon) return a.bearing;
  return bearing([a.lat, a.lon], [b.lat, b.lon]);
}

/** The route up to distance d (for the "already driven" grey line): the points before d, then the exact position. */
export function drivenLine(g: NavGeometry, d: number): LatLon[] {
  const pos = positionAt(g, d);
  return [...g.coordinates.slice(0, pos.index + 1), [pos.lat, pos.lon] as LatLon];
}

/** The rest of the route from distance d to the end. */
export function remainingLine(g: NavGeometry, d: number): LatLon[] {
  const pos = positionAt(g, d);
  return [[pos.lat, pos.lon] as LatLon, ...g.coordinates.slice(pos.index + 1)];
}

/** A circle as a closed [lon, lat] ring (GeoJSON order), for drawing a hotspot's risk buffer on a map. */
export function circleRing(lat: number, lon: number, radiusM: number, steps = 64): [number, number][] {
  const out: [number, number][] = [];
  const dLat = deg(radiusM / EARTH_RADIUS_M);
  const dLon = deg(radiusM / (EARTH_RADIUS_M * Math.cos(rad(lat))));
  for (let i = 0; i <= steps; i++) {
    const t = (2 * Math.PI * (i % steps)) / steps;
    out.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return out;
}
