/**
 * Pure helpers for the route result page. Every number shown comes from the backend's route data
 * (WEB_APP_PLAN.md rule 6); this file only rounds it, always the same way (half up) as the backend does.
 */
import type { RouteResponse } from '../../api/schemas.ts';

export const roundHalfUp = (x: number) => Math.floor(x + 0.5);

/** "under a minute", "about 1 minute", "about 5 minutes" (never "0 minutes"). */
export function minutesPhrase(x: number): string {
  if (x < 0.5) return 'under a minute';
  const n = roundHalfUp(x);
  return `about ${n} minute${n === 1 ? '' : 's'}`;
}

/** Compact "12 min" for table cells. */
export const minutesShort = (x: number) => `${roundHalfUp(x)} min`;
export const kmShort = (x: number) => `${x.toFixed(1)} km`;

export type Effect = { label: string; value: string; positive: boolean };

/**
 * The line under the comparison card. It uses the word "saved" only when the expected saving is positive, the
 * same rule as the spoken advice; otherwise it states the extra driving and that the avoided delay is smaller.
 */
export function effectLine(r: Pick<RouteResponse, 'identical_routes' | 'expected_saving_min' | 'added_drive_min'>): Effect {
  if (r.identical_routes) return { label: 'Difference', value: 'None: both routes are the same', positive: false };
  if (r.expected_saving_min > 0) {
    return { label: 'Expected time saved', value: `${minutesPhrase(r.expected_saving_min)} overall`, positive: true };
  }
  return {
    label: 'Net effect',
    value: `adds ${minutesPhrase(r.added_drive_min)} of driving, more than the flood delay it avoids`,
    positive: false,
  };
}

export type CompareRow = { label: string; usual: string; routerain: string };

export function compareRows(r: RouteResponse): CompareRow[] {
  const names = (hs: RouteResponse['normal_route']['near_hotspots']) =>
    hs.length === 0 ? 'None' : hs.map((h) => `${h.name} (${h.tier === 'LOW_RAIN' ? 'LOW RAIN' : h.tier})`).join(', ');
  return [
    { label: 'Drive time', usual: minutesShort(r.normal_route.drive_time_min), routerain: minutesShort(r.flood_aware_route.drive_time_min) },
    { label: 'Distance', usual: kmShort(r.normal_route.distance_km), routerain: kmShort(r.flood_aware_route.distance_km) },
    { label: 'Hotspots passed', usual: names(r.normal_route.near_hotspots), routerain: names(r.flood_aware_route.near_hotspots) },
    {
      label: 'Expected time incl. flood risk',
      usual: minutesShort(r.normal_route.expected_time_min),
      routerain: minutesShort(r.flood_aware_route.expected_time_min),
    },
  ];
}
