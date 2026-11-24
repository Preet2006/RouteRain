import { describe, expect, it } from 'vitest';

import { HealthSchema, HotspotDetailSchema, HotspotsResponseSchema, NarrateResponseSchema, RouteResponseSchema } from './schemas';

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
          explanation: 'LOW RAIN: not scored.', reported_outcome: null, type: 'chowk/highway' },
        { id: 'H02', name: 'Rajiv Chowk', lat: 28.44, lon: 77.03, tier: 'YELLOW', probability: 0.18,
          explanation: 'Rajiv Chowk - YELLOW', reported_outcome: 'flooded', type: 'chowk/underpass' },
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

describe('hotspot detail schema', () => {
  const base = {
    scenario: { mode: 'replay', date: '2025-07-09', forecast_generated_at: null },
    hotspot: { id: 'H01', name: 'Bilaspur Chowk', lat: 28.28, lon: 76.86, tier: 'LOW_RAIN', probability: null, explanation: 'x', reported_outcome: null, type: 'chowk/highway' },
    buffer_m: 300,
    terrain: { elevation_m: 243, sink_depth_m: 0.05, slope_deg: 4.3, catchment_cells: 495 },
    conditions: null,
    history: { recorded_floods: 7, first_date: '2022-09-22', last_date: '2026-07-07' },
    infrastructure: { flagged: true, note: 'Choked drain', evidence_date: '2025-12-04', source_url: 'https://example.org/x' },
  };
  it('accepts a LOW RAIN detail (null conditions) and a scored one', () => {
    expect(HotspotDetailSchema.safeParse(base).success).toBe(true);
    const scored = { ...base, conditions: { rain_24h: 48, rain_max_1h: 21, rain_max_3h: 33, rain_prev_3d: 8, soil_moisture_surface: 0.4, rain_season_cumulative: 600 } };
    expect(HotspotDetailSchema.safeParse(scored).success).toBe(true);
  });
  it('accepts no infrastructure source and no flood dates', () => {
    expect(HotspotDetailSchema.safeParse({ ...base, history: { recorded_floods: 0, first_date: null, last_date: null }, infrastructure: { flagged: false, note: null, evidence_date: null, source_url: null } }).success).toBe(true);
  });
  it('rejects a missing terrain block or a non-integer flood count', () => {
    const { terrain: _t, ...noTerrain } = base;
    expect(HotspotDetailSchema.safeParse(noTerrain).success).toBe(false);
    expect(HotspotDetailSchema.safeParse({ ...base, history: { ...base.history, recorded_floods: 2.5 } }).success).toBe(false);
  });
});

describe('schemas reject bad payloads', () => {
  it('unknown tier, probability out of range, polyline over 300 points', () => {
    const base = {
      scenario: { mode: 'live', date: null, forecast_generated_at: null },
      tiers: { RED: 0, YELLOW: 0, GREEN: 1, LOW_RAIN: 0 },
    };
    const item = { id: 'H01', name: 'x', lat: 1, lon: 1, tier: 'GREEN', probability: 0.1, explanation: '', reported_outcome: null, type: '' };
    expect(HotspotsResponseSchema.safeParse({ ...base, hotspots: [{ ...item, tier: 'PURPLE' }] }).success).toBe(false);
    expect(HotspotsResponseSchema.safeParse({ ...base, hotspots: [{ ...item, probability: 1.5 }] }).success).toBe(false);
    const big = { ...leg, polyline: Array.from({ length: 301 }, () => [1, 1]) };
    expect(RouteResponseSchema.safeParse({ normal_route: big }).success).toBe(false);
  });
});
