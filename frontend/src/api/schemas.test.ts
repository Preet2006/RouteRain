import { describe, expect, it } from 'vitest';

import { HealthSchema, HotspotsResponseSchema, NarrateResponseSchema, RouteResponseSchema } from './schemas';

// Payloads copied from real /api/v2 responses (W1/W2 runs). `npm run check:contract` re-checks them live.
const leg = {
  polyline: [[28.49, 77.08], [28.48, 77.07]], drive_time_min: 7.8, distance_km: 8.9,
  near_hotspots: [{ id: 'H02', name: 'Rajiv Chowk', tier: 'RED', probability: 0.3889 }], expected_time_min: 16.9,
};

describe('schemas accept real backend payloads', () => {
  it('health', () => {
    expect(HealthSchema.safeParse({
      ok: true, model_loaded: true, graph_loaded: true, llm_available: true, model_file_present: true,
      places: { count: 65, verified: 0 }, flood_delay_min: 23.4, api_version: 'v2',
    }).success).toBe(true);
  });

  it('hotspots with a LOW_RAIN item (null probability, null outcome)', () => {
    const r = HotspotsResponseSchema.safeParse({
      scenario: { mode: 'replay', date: '2025-07-09', forecast_generated_at: null },
      tiers: { RED: 0, YELLOW: 8, GREEN: 3, LOW_RAIN: 1 },
      hotspots: [
        { id: 'H01', name: 'Bilaspur Chowk', lat: 28.28, lon: 76.86, tier: 'LOW_RAIN', probability: null,
          explanation: 'LOW RAIN: not scored.', reported_outcome: null },
        { id: 'H02', name: 'Rajiv Chowk', lat: 28.44, lon: 77.03, tier: 'YELLOW', probability: 0.18,
          explanation: 'Rajiv Chowk - YELLOW', reported_outcome: 'flooded' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('route', () => {
    const r = RouteResponseSchema.safeParse({
      route_id: 'abc123abc123', scenario: { mode: 'replay', date: '2026-08-07', forecast_generated_at: null },
      origin: { lat: 28.49, lon: 77.08, label: 'Cyber Hub' }, destination: { lat: 28.43, lon: 77.04, label: '' },
      caution: 'cautious', normal_route: leg, flood_aware_route: { ...leg, near_hotspots: [] }, identical_routes: false,
      expected_saving_min: 8.1, added_drive_min: 1.1, flood_delay_min: 23.4,
      avoided_hotspots: [{ id: 'H02', name: 'Rajiv Chowk', tier: 'RED', probability: 0.39, explanation: 'x' }],
      still_passes_through: [],
      risk_zones: [{ id: 'H02', name: 'Rajiv Chowk', lat: 28.44, lon: 77.03, tier: 'RED', radius_m: 500 }],
      template_advice: 'On 7 August 2026, ...',
    });
    expect(r.success).toBe(true);
  });

  it('narrate', () => {
    expect(NarrateResponseSchema.safeParse({
      text: 'x', source: 'llm', language: 'hi', scenario: { mode: 'live', date: null, forecast_generated_at: 'now' },
    }).success).toBe(true);
  });
});

describe('schemas reject bad payloads', () => {
  it('unknown tier, probability out of range, polyline over 300 points', () => {
    const base = {
      scenario: { mode: 'live', date: null, forecast_generated_at: null },
      tiers: { RED: 0, YELLOW: 0, GREEN: 1, LOW_RAIN: 0 },
    };
    const item = { id: 'H01', name: 'x', lat: 1, lon: 1, tier: 'GREEN', probability: 0.1, explanation: '', reported_outcome: null };
    expect(HotspotsResponseSchema.safeParse({ ...base, hotspots: [{ ...item, tier: 'PURPLE' }] }).success).toBe(false);
    expect(HotspotsResponseSchema.safeParse({ ...base, hotspots: [{ ...item, probability: 1.5 }] }).success).toBe(false);
    const big = { ...leg, polyline: Array.from({ length: 301 }, () => [1, 1]) };
    expect(RouteResponseSchema.safeParse({ normal_route: big }).success).toBe(false);
  });
});
