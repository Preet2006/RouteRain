// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HotspotDetail as Detail } from '@/api/schemas';

const api = vi.hoisted(() => ({ getHotspotDetail: vi.fn() }));
vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly kind: string, message: string) {
      super(message);
    }
  },
  getHotspotDetail: api.getHotspotDetail,
}));
// Leaflet needs real layout; the map is covered in features/hotspots/HotspotDetailMap.test.tsx.
vi.mock('@/features/hotspots/HotspotDetailMap', () => ({
  HotspotDetailMap: (p: { hotspot: { id: string }; bufferM: number }) => <div data-testid="map" data-id={p.hotspot.id} data-buffer={p.bufferM} />,
}));

import { ApiError } from '@/api/client';
import { ScenarioProvider, type ScenarioChoice } from '@/lib/scenario';
import { HotspotDetail } from '@/pages/HotspotDetail';

const EXPL = 'Rajiv Chowk - RED (39% estimated risk). Conditions lean toward elevated risk: the ground has already absorbed 38mm of rain over the preceding 3 days. It has flooded on 20 of the last 60 comparable rain days at this location.';
const SCORED: Detail = {
  scenario: { mode: 'replay', date: '2026-08-07', forecast_generated_at: null },
  hotspot: { id: 'H02', name: 'Rajiv Chowk', lat: 28.4474509, lon: 77.0327407, tier: 'RED', probability: 0.3889, explanation: EXPL, reported_outcome: 'flooded', type: 'chowk/underpass' },
  buffer_m: 500,
  terrain: { elevation_m: 228, sink_depth_m: -0.697, slope_deg: 6.75, catchment_cells: 452 },
  conditions: { rain_24h: 48.2, rain_max_1h: 21, rain_max_3h: 33.5, rain_prev_3d: 38, soil_moisture_surface: 0.42, rain_season_cumulative: 611.4 },
  history: { recorded_floods: 18, first_date: '2022-09-22', last_date: '2026-09-05' },
  infrastructure: { flagged: true, note: 'Medanta underpass (Rajiv Chowk) shut after pump failure.', evidence_date: '2024-08-11', source_url: 'https://www.tribuneindia.com/news/x' },
};
const LOW: Detail = {
  scenario: { mode: 'replay', date: '2025-07-09', forecast_generated_at: null },
  hotspot: { id: 'H01', name: 'Bilaspur Chowk', lat: 28.2886, lon: 76.8602, tier: 'LOW_RAIN', probability: null, explanation: 'Bilaspur Chowk: LOW RAIN: not scored.', reported_outcome: null, type: 'chowk/highway' },
  buffer_m: 300,
  terrain: { elevation_m: 243, sink_depth_m: 2.06, slope_deg: 4.3, catchment_cells: 495 },
  conditions: null,
  history: { recorded_floods: 7, first_date: '2022-09-22', last_date: '2026-07-07' },
  infrastructure: { flagged: false, note: 'No specific infrastructure defect found in collected sources', evidence_date: null, source_url: null },
};

function renderDetail(id = 'H02', initial?: ScenarioChoice) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/hotspots/${id}`]}>
        <ScenarioProvider initial={initial}>
          <Routes>
            <Route path="/hotspots/:id" element={<HotspotDetail />} />
            <Route path="*" element={<div>elsewhere</div>} />
          </Routes>
        </ScenarioProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const REPLAY: ScenarioChoice = { mode: 'replay', date: '2026-08-07' };
const panel = () => screen.getByRole('complementary');
const loaded = (name = 'Rajiv Chowk') => screen.findByRole('heading', { level: 1, name });

beforeEach(() => {
  api.getHotspotDetail.mockResolvedValue(SCORED);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('hotspot detail page', () => {
  it('shows tier, probability, the full explanation, location and the risk zone', async () => {
    renderDetail('H02', REPLAY);
    expect((await loaded()).textContent).toBe('Rajiv Chowk');
    const p = panel().textContent!;
    expect(p).toContain('Chowk · Underpass');
    expect(p).toContain('RED: avoid');
    expect(p).toContain('about 35 to 40%');
    expect(p).toContain(EXPL); // the FULL sentence, not just the first reason
    expect(p).toMatch(/Risk zone for routing\s*500 m/);
    expect(p).toContain('28.44745, 77.03274');
    expect(screen.getByTestId('map').dataset).toMatchObject({ id: 'H02', buffer: '500' });
  });

  it('replay: the dated banner and the reported outcome kept separate from the prediction', async () => {
    renderDetail('H02', REPLAY);
    await loaded();
    expect(screen.getByText(/replay: 7 august 2026 weather/i)).toBeTruthy();
    expect(panel().textContent).toMatch(/Reported that day:\s*Flooded/);
    expect(panel().textContent).toMatch(/separate from the prediction/i);
    expect(api.getHotspotDetail).toHaveBeenCalledWith('H02', 'replay', '2026-08-07');
  });

  it('live: no replay banner and no reported-that-day line', async () => {
    api.getHotspotDetail.mockResolvedValue({ ...SCORED, scenario: { mode: 'live', date: null, forecast_generated_at: 'x' }, hotspot: { ...SCORED.hotspot, reported_outcome: null } });
    renderDetail('H02');
    await loaded();
    expect(document.body.textContent).not.toMatch(/replay:|reported that day/i);
    expect(screen.getByRole('heading', { name: 'Conditions in the forecast' })).toBeTruthy();
    expect(api.getHotspotDetail).toHaveBeenCalledWith('H02', 'live', null);
  });

  it('shows the rain and soil conditions of the scenario day', async () => {
    renderDetail('H02', REPLAY);
    const section = (await screen.findByRole('heading', { name: 'Conditions that day' })).closest('section')!;
    const rows = within(section).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual([
      'Rain over the day48 mm', 'Heaviest hour21 mm', 'Heaviest 3 hours34 mm', 'Rain in the previous 3 days38 mm',
      'Ground wetness (soil moisture)42%', 'Rain so far this monsoon611 mm',
    ]);
  });

  it('terrain is described honestly: a point above its surroundings is not called a bowl', async () => {
    renderDetail('H02', REPLAY);
    const section = (await screen.findByRole('heading', { name: 'The ground here' })).closest('section')!;
    expect(section.textContent).toMatch(/Elevation\s*228 m/);
    expect(section.textContent).toMatch(/0\.7 m above the ground around it/);
    expect(section.textContent).toMatch(/30 m elevation model/i);
  });

  it('past floods and the infrastructure issue, with its source link opened safely in a new tab', async () => {
    renderDetail('H02', REPLAY);
    await loaded();
    expect(screen.getByText('18 flood reports, Sep 2022 to Sep 2026')).toBeTruthy();
    expect(panel().textContent).toContain('Medanta underpass (Rajiv Chowk) shut after pump failure.');
    const link = screen.getByRole('link', { name: /read the source report/i });
    expect(link.getAttribute('href')).toBe('https://www.tribuneindia.com/news/x');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('a LOW RAIN hotspot: not scored, no percentage, no conditions, static facts still shown', async () => {
    api.getHotspotDetail.mockResolvedValue(LOW);
    renderDetail('H01', { mode: 'replay', date: '2025-07-09' });
    await loaded('Bilaspur Chowk');
    expect(panel().textContent).toContain('LOW RAIN: not scored (under 10 mm)');
    expect(panel().textContent).toMatch(/Estimated risk\s*Not scored/);
    expect(panel().textContent).toMatch(/Not scored: rain at this spot was under 10 mm/);
    expect(panel().textContent).toMatch(/2\.1 m below the ground around it/);
    expect(panel().textContent).toContain('7 flood reports');
    expect(panel().textContent).toMatch(/Reported that day:\s*Not recorded \(rain under 10 mm\)/);
    expect(panel().textContent).not.toMatch(/%/);
    expect(screen.queryByRole('link', { name: /source report/i })).toBeNull();
    expect(screen.getByTestId('map').dataset.buffer).toBe('300');
  });

  it('offers "Plan a trip avoiding this" and "Back to all hotspots", keeping the replay day', async () => {
    renderDetail('H02', REPLAY);
    await loaded();
    expect(screen.getByRole('link', { name: 'Plan a trip avoiding this' }).getAttribute('href')).toBe('/plan');
    expect(screen.getByRole('link', { name: 'Back to all hotspots' }).getAttribute('href')).toBe('/hotspots?replay=2026-08-07');
    expect(screen.getByRole('link', { name: '← All hotspots' }).getAttribute('href')).toBe('/hotspots?replay=2026-08-07');
    cleanup();
    api.getHotspotDetail.mockResolvedValue({ ...SCORED, scenario: { mode: 'live', date: null, forecast_generated_at: 'x' } });
    renderDetail('H02');
    await loaded();
    expect(screen.getByRole('link', { name: 'Back to all hotspots' }).getAttribute('href')).toBe('/hotspots');
  });

  it('an unknown hotspot shows the server message and a way back', async () => {
    api.getHotspotDetail.mockRejectedValue(new ApiError('http', 'No hotspot with that id.'));
    renderDetail('H99');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/no hotspot with that id/i);
    expect(within(alert).getByRole('link', { name: /back to all hotspots/i }).getAttribute('href')).toBe('/hotspots');
  });

  it('shows a loading state first', async () => {
    api.getHotspotDetail.mockReturnValue(new Promise(() => {}));
    renderDetail();
    expect(await screen.findByRole('heading', { name: /loading hotspot/i })).toBeTruthy();
  });
});
