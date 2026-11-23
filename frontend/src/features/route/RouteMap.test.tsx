// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { RouteResponse } from '@/api/schemas';

import { RouteMap } from './RouteMap';

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 900 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 900 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

const leg = (pts: [number, number][]) => ({ polyline: pts, drive_time_min: 8, distance_km: 9, near_hotspots: [], expected_time_min: 8 });
const route = (identical: boolean): RouteResponse => ({
  route_id: 'r', scenario: { mode: 'replay', date: '2026-08-07', forecast_generated_at: null },
  origin: { lat: 28.4951, lon: 77.0891, label: 'A' }, destination: { lat: 28.4395, lon: 77.0422, label: 'B' },
  caution: 'cautious', identical_routes: identical, expected_saving_min: 0, added_drive_min: 0, flood_delay_min: 23.4,
  normal_route: leg([[28.49, 77.08], [28.47, 77.06], [28.44, 77.04]]),
  flood_aware_route: leg([[28.49, 77.08], [28.48, 77.05], [28.44, 77.04]]),
  avoided_hotspots: [], still_passes_through: [],
  risk_zones: [
    { id: 'H02', name: 'Rajiv Chowk', lat: 28.447, lon: 77.032, tier: 'RED', radius_m: 500 },
    { id: 'H07', name: 'Subhash Chowk', lat: 28.427, lon: 77.037, tier: 'YELLOW', radius_m: 300 },
  ],
  template_advice: '',
});

afterEach(cleanup);

describe('RouteMap', () => {
  it('draws the usual route (dashed grey), the RouteRain route (blue) and a circle per risk zone', () => {
    const { container } = render(<RouteMap route={route(false)} />);
    const paths = [...container.querySelectorAll('path.leaflet-interactive')];
    expect(paths).toHaveLength(4); // 2 routes + 2 zones
    const lines = paths.filter((p) => p.getAttribute('fill') === 'none' || p.getAttribute('fill') === null);
    expect(paths.some((p) => p.getAttribute('stroke-dasharray') === '9 9' && p.getAttribute('stroke') === '#9aa5b1')).toBe(true);
    expect(paths.some((p) => p.getAttribute('stroke') === '#5ed6ff' && !p.getAttribute('stroke-dasharray'))).toBe(true);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('.rr-pin.A')).toHaveLength(1);
    expect(container.querySelectorAll('.rr-pin.B')).toHaveLength(1);
  });

  it('identical routes draw a single line plus the zones', () => {
    const { container } = render(<RouteMap route={route(true)} />);
    expect(container.querySelectorAll('path.leaflet-interactive')).toHaveLength(3);
  });

  it('colours the zones by tier (colour is paired with the tooltip word and the legend text)', () => {
    const { container } = render(<RouteMap route={route(false)} />);
    const strokes = [...container.querySelectorAll('path.leaflet-interactive')].map((p) => p.getAttribute('stroke'));
    expect(strokes).toContain('#ff667c');
    expect(strokes).toContain('#ffca68');
  });
});
