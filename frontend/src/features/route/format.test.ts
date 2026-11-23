import { describe, expect, it } from 'vitest';

import type { RouteResponse } from '../../api/schemas';
import { compareRows, effectLine, minutesPhrase, minutesShort, roundHalfUp } from './format';

describe('rounding', () => {
  it('rounds half up, like the backend (2.5 -> 3, not 2)', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(8.49)).toBe(8);
    expect(minutesShort(8.5)).toBe('9 min');
  });
  it('phrases minutes without ever saying 0 minutes', () => {
    expect(minutesPhrase(0.2)).toBe('under a minute');
    expect(minutesPhrase(1.1)).toBe('about 1 minute');
    expect(minutesPhrase(5.4)).toBe('about 5 minutes');
  });
});

describe('effectLine', () => {
  it('uses "saved" only for a positive expected saving', () => {
    const e = effectLine({ identical_routes: false, expected_saving_min: 8.1, added_drive_min: 1.1 });
    expect(e).toEqual({ label: 'Expected time saved', value: 'about 8 minutes overall', positive: true });
  });
  it.each([0, -0.4, -12])('never uses the word saved/saving when the saving is %s', (saving) => {
    const e = effectLine({ identical_routes: false, expected_saving_min: saving, added_drive_min: 3 });
    expect(`${e.label} ${e.value}`).not.toMatch(/sav/i);
    expect(e.positive).toBe(false);
    expect(e.value).toMatch(/adds about 3 minutes of driving/);
  });
  it('says there is no difference for identical routes', () => {
    const e = effectLine({ identical_routes: true, expected_saving_min: 0, added_drive_min: 0 });
    expect(e.value).toMatch(/both routes are the same/i);
  });
});

describe('compareRows', () => {
  const leg = (t: number, d: number, e: number, near: RouteResponse['normal_route']['near_hotspots']) =>
    ({ polyline: [], drive_time_min: t, distance_km: d, near_hotspots: near, expected_time_min: e });
  const route = {
    normal_route: leg(7.8, 8.94, 16.9, [{ id: 'H02', name: 'Rajiv Chowk', tier: 'RED', probability: 0.39 }, { id: 'H04', name: 'Narsingpur', tier: 'LOW_RAIN', probability: null }]),
    flood_aware_route: leg(8.8, 8.8, 8.8, []),
  } as unknown as RouteResponse;

  it('shows backend numbers rounded the same way everywhere, with tier words', () => {
    expect(compareRows(route)).toEqual([
      { label: 'Drive time', usual: '8 min', routerain: '9 min' },
      { label: 'Distance', usual: '8.9 km', routerain: '8.8 km' },
      { label: 'Hotspots passed', usual: 'Rajiv Chowk (RED), Narsingpur (LOW RAIN)', routerain: 'None' },
      { label: 'Expected time incl. flood risk', usual: '17 min', routerain: '9 min' },
    ]);
  });
});
