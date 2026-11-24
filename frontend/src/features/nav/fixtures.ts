/** Test fixtures only: a small but realistic trip (directions + route) built the way the backend builds them. */
import type { Directions, HotspotEvent, NavStep, RouteResponse } from '@/api/schemas';

import { haversine, type LatLon } from './geo';

const LAT0 = 28.45;
const LON0 = 77.03;
const M_LAT = 111_195;
const M_LON = M_LAT * Math.cos((LAT0 * Math.PI) / 180);
const at = (east: number, north: number): LatLon => [LAT0 + north / M_LAT, LON0 + east / M_LON];

/**
 * Start -> 1500 m east on "Sohna Road" (fast, 20 m/s) -> LEFT onto "Golf Course Road" (north, 1200 m, 10 m/s)
 * -> RIGHT (east, 900 m, unnamed, 10 m/s) -> RIGHT 120 m south onto "Short Lane" (10 m/s) -> arrive. 3720 m in total.
 */
export function makeDirections(overrides: Partial<Directions> = {}): Directions {
  const corners: [number, number][] = [
    [0, 0], [750, 0], [1500, 0], // Sohna Road (a middle vertex so the line is not just two points)
    [1500, 600], [1500, 1200], // Golf Course Road
    [2100, 1200], [2400, 1200], // unnamed
    [2400, 1080], // Short Lane
  ];
  const coordinates = corners.map(([e, n]) => at(e, n));
  const cumulative_m = [0];
  for (let i = 1; i < coordinates.length; i++) cumulative_m.push(cumulative_m[i - 1] + haversine(coordinates[i - 1], coordinates[i]));
  const total = cumulative_m[cumulative_m.length - 1];
  const idx = [0, 2, 4, 6, 7]; // vertex of each step
  const at_ = (i: number) => Math.round(cumulative_m[idx[i]] * 10) / 10;
  const mk = (i: number, s: Partial<NavStep>): NavStep => ({
    index: i,
    maneuver: 'turn',
    modifier: 'left',
    street: null,
    distance_m: Math.round((((idx[i + 1] !== undefined ? cumulative_m[idx[i + 1]] : total) - cumulative_m[idx[i]]) * 10)) / 10,
    duration_s: 0,
    location: coordinates[idx[i]] as [number, number],
    bearing_before: null,
    bearing_after: null,
    exit_number: null,
    instruction_en: '',
    path_index: idx[i],
    start_m: at_(i),
    ...s,
  });
  const steps: NavStep[] = [
    mk(0, { maneuver: 'depart', modifier: null, street: 'Sohna Road', bearing_after: 90, instruction_en: 'Head east on Sohna Road' }),
    mk(1, { maneuver: 'turn', modifier: 'left', street: 'Golf Course Road', bearing_before: 90, bearing_after: 0, instruction_en: 'Turn left onto Golf Course Road' }),
    mk(2, { maneuver: 'turn', modifier: 'right', street: null, bearing_before: 0, bearing_after: 90, instruction_en: 'Turn right' }),
    mk(3, { maneuver: 'turn', modifier: 'right', street: 'Short Lane', bearing_before: 90, bearing_after: 180, instruction_en: 'Turn right onto Short Lane' }),
    mk(4, { maneuver: 'arrive', modifier: null, distance_m: 0, bearing_before: 180, instruction_en: 'You have arrived at your destination' }),
  ];
  const speeds = [20, 10, 10, 10, 10];
  steps.forEach((s, i) => (s.duration_s = Math.round((s.distance_m / speeds[i]) * 10) / 10));
  const duration = steps.reduce((a, s) => a + s.duration_s, 0);
  const event: HotspotEvent = {
    hotspot_id: 'H02', name: 'Rajiv Chowk', tier: 'RED', buffer_m: 500, approach_distance_m: 2100, closest_distance_along_m: 2700,
    closest_distance_m: 900, exit_distance_m: 3300, side: 'right', within_radius: true, passes_through: false, avoided: true,
  };
  return {
    route_id: 'abc123abc123', which: 'flood_aware', language: 'en',
    total_distance_m: Math.round(total * 10) / 10, total_duration_s: Math.round(duration * 10) / 10,
    steps,
    geometry: { coordinates: coordinates as [number, number][], cumulative_m: cumulative_m.map((c) => Math.round(c * 10) / 10), step_point_index: idx },
    hotspot_events: [event],
    ...overrides,
  };
}

export function makeRoute(overrides: Partial<RouteResponse> = {}): RouteResponse {
  const d = makeDirections();
  const leg = { polyline: d.geometry.coordinates.slice(), drive_time_min: 8.8, distance_km: 3.72, near_hotspots: [], expected_time_min: 8.8 };
  return {
    route_id: 'abc123abc123',
    scenario: { mode: 'replay', date: '2026-08-07', forecast_generated_at: null },
    origin: { lat: LAT0, lon: LON0, label: 'Cyber Hub' },
    destination: { lat: at(2400, 1080)[0], lon: at(2400, 1080)[1], label: 'Medanta' },
    caution: 'cautious',
    normal_route: { ...leg, drive_time_min: 7.8, distance_km: 3.5 },
    flood_aware_route: leg,
    identical_routes: false,
    expected_saving_min: 8.1, added_drive_min: 1.1, flood_delay_min: 23.4,
    avoided_hotspots: [{ id: 'H02', name: 'Rajiv Chowk', tier: 'RED', probability: 0.39, explanation: 'Rajiv Chowk - RED.' }],
    still_passes_through: [],
    risk_zones: [{ id: 'H02', name: 'Rajiv Chowk', lat: at(2700, 300)[0], lon: at(2700, 300)[1], tier: 'RED', radius_m: 500 }],
    template_advice: 'On 7 August 2026, this route adds about 1 minute of driving but is expected to save about 8 minutes overall by avoiding Rajiv Chowk (RED).',
    ...overrides,
  };
}
