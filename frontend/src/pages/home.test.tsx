// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Hotspot, HotspotsResponse } from '@/api/schemas';

const api = vi.hoisted(() => ({ getHotspots: vi.fn(), getScenarios: vi.fn() }));
vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly kind: string, message: string) {
      super(message);
    }
  },
  getHotspots: api.getHotspots,
  getScenarios: api.getScenarios,
}));
// Leaflet needs real layout; the map is covered in features/home/HotspotMap.test.tsx.
vi.mock('@/features/home/HotspotMap', () => ({
  HotspotMap: (p: { hotspots: Hotspot[]; selectedId: string | null; loading?: boolean }) => (
    <div data-testid="map" data-count={p.hotspots.length} data-selected={p.selectedId ?? ''} data-loading={String(!!p.loading)} />
  ),
}));

import { ApiError } from '@/api/client';
import { ScenarioProvider } from '@/lib/scenario';
import { profileStore } from '@/lib/storage';
import { Home } from '@/pages/Home';

const spot = (n: number, tier: Hotspot['tier'], p: number | null, reported: Hotspot['reported_outcome'] = null): Hotspot => ({
  id: `H${String(n).padStart(2, '0')}`, name: `Spot ${n}`, lat: 28.4 + n / 100, lon: 77 + n / 100, tier, probability: p,
  explanation: `Spot ${n} - ${tier}. Because of reasons.`, reported_outcome: reported,
});
function response(hotspots: Hotspot[], scenario: HotspotsResponse['scenario']): HotspotsResponse {
  const tiers = { RED: 0, YELLOW: 0, GREEN: 0, LOW_RAIN: 0 };
  hotspots.forEach((h) => (tiers[h.tier] += 1));
  return { scenario, tiers, hotspots };
}
const LIVE = response(
  Array.from({ length: 12 }, (_, i) => spot(i + 1, 'GREEN', 0.02 + i / 1000)),
  { mode: 'live', date: null, forecast_generated_at: '2026-11-21T07:30:00+00:00' },
);
const REPLAY = response(
  [spot(1, 'GREEN', 0.04, 'no_report'), spot(2, 'YELLOW', 0.2, 'flooded'), spot(3, 'RED', 0.39, 'flooded'),
   spot(4, 'LOW_RAIN', null), ...Array.from({ length: 8 }, (_, i) => spot(i + 5, 'GREEN', 0.03, 'no_report'))],
  { mode: 'replay', date: '2026-08-07', forecast_generated_at: null },
);

function LocationProbe() {
  const l = useLocation();
  return <div data-testid="loc" data-path={l.pathname} data-state={JSON.stringify(l.state)} />;
}
function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <ScenarioProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </ScenarioProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  profileStore.reload();
  profileStore.update({ onboarded: true, name: 'Tanish' });
  api.getScenarios.mockResolvedValue({
    default_mode: 'live',
    scenarios: [{ date: '2026-08-07', label: '7 August 2026' }, { date: '2026-07-08', label: '8 July 2026' }],
  });
  api.getHotspots.mockImplementation(async (mode: string) => (mode === 'live' ? LIVE : REPLAY));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Home: live', () => {
  it('greets, shows the forecast time, 12 hotspots and the no-rain note when everything is GREEN', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { name: /good (morning|afternoon|evening), tanish/i })).toBeTruthy();
    expect(await screen.findByText(/forecast updated/i)).toBeTruthy();
    expect(screen.getByTestId('map').dataset.count).toBe('12');
    expect(screen.getByText(/no rain is forecast, so every hotspot is green/i)).toBeTruthy();
    const counts = screen.getByRole('list', { name: /hotspots by risk/i });
    expect(within(counts).getByText('12')).toBeTruthy();
    expect(within(counts).queryByText(/low rain/i)).toBeNull(); // hidden when zero
    expect(screen.queryByText(/reported that day/i)).toBeNull();
    expect(screen.queryByRole('status', { name: '' })?.textContent ?? '').not.toMatch(/replay/i);
    expect(api.getHotspots).toHaveBeenCalledWith('live', null);
  });

  it('shows a skeleton with the slow-first-load warning while loading', async () => {
    api.getHotspots.mockReturnValue(new Promise(() => {}));
    renderHome();
    expect(await screen.findByLabelText(/loading hotspots/i)).toBeTruthy();
    expect(screen.getByText(/can take up to 30 seconds/i)).toBeTruthy();
    expect(screen.getByTestId('map').dataset.loading).toBe('true');
  });

  it("shows \"Can't reach RouteRain server\" with a Retry that works", async () => {
    api.getHotspots.mockRejectedValueOnce(new ApiError('network', "Can't reach the RouteRain server."));
    const user = userEvent.setup();
    renderHome();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/can't reach routerain server/i);
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/forecast updated/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the server message for other errors', async () => {
    api.getHotspots.mockRejectedValueOnce(new ApiError('http', 'Project data is incomplete. Check the model and data files.'));
    renderHome();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/hotspots could not be loaded/i);
    expect(alert.textContent).toMatch(/project data is incomplete/i);
  });
});

describe('Home: replay', () => {
  it('switching to replay shows the dated banner, LOW RAIN count and reports hotspots for that date', async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByText(/forecast updated/i);
    await user.click(screen.getByRole('radio', { name: /replay a past monsoon day/i }));

    const banner = await screen.findByText(/replay: 7 august 2026 weather/i);
    expect(banner.closest('[role=status]')?.textContent).toMatch(/not today.s forecast/i);
    expect(api.getHotspots).toHaveBeenLastCalledWith('replay', '2026-08-07');
    expect(await screen.findByText(/replay of 7 august 2026/i)).toBeTruthy();
    const counts = screen.getByRole('list', { name: /hotspots by risk/i });
    expect(within(counts).getByText(/low rain/i)).toBeTruthy();
    expect(screen.queryByText(/no rain is forecast/i)).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem('routerain.scenario')!)).toEqual({ mode: 'replay', date: '2026-08-07' });
  });

  it('choosing another day re-queries and keeps the choice', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('radio', { name: /replay a past monsoon day/i }));
    await user.selectOptions(await screen.findByLabelText('Day'), '2026-07-08');
    await waitFor(() => expect(api.getHotspots).toHaveBeenLastCalledWith('replay', '2026-07-08'));
    expect(await screen.findByText(/replay: 8 july 2026 weather/i)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /live forecast/i }));
    expect(screen.queryByText(/replay: /i)).toBeNull();
  });

  it('lists RED first, and selecting a hotspot shows its details with the reported outcome kept separate', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('radio', { name: /replay a past monsoon day/i }));
    await screen.findByText(/replay of 7 august 2026/i);

    const rows = screen.getAllByRole('button', { name: /spot \d+/i }).map((b) => b.textContent!);
    expect(rows[0]).toMatch(/RED.*Spot 3/);
    expect(rows[1]).toMatch(/YELLOW.*Spot 2/);
    expect(rows[rows.length - 1]).toMatch(/LOW RAIN.*Spot 4.*not scored/);

    await user.click(screen.getByRole('button', { name: /spot 3/i }));
    const details = screen.getByRole('region', { name: /spot 3 details/i });
    expect(details.textContent).toMatch(/RED: avoid/);
    expect(details.textContent).toMatch(/about 35 to 40%/);
    expect(details.textContent).toMatch(/28\.43000, 77\.03000/);
    expect(details.textContent).toMatch(/Spot 3 - RED\. Because of reasons\./);
    expect(details.textContent).toMatch(/Reported that day:\s*Flooded \(reported\)/);
    expect(details.textContent).toMatch(/separate from the prediction/i);
    expect(screen.getByTestId('map').dataset.selected).toBe('H03');

    await user.click(screen.getByRole('button', { name: /close spot 3 details/i }));
    expect(screen.queryByRole('region', { name: /details/i })).toBeNull();
    expect(screen.getByTestId('map').dataset.selected).toBe('');
  });

  it('a LOW RAIN hotspot says it is not scored and never shows a probability', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('radio', { name: /replay a past monsoon day/i }));
    await screen.findByText(/replay of 7 august 2026/i);
    await user.click(screen.getByRole('button', { name: /spot 4/i }));
    const details = screen.getByRole('region', { name: /spot 4 details/i });
    expect(details.textContent).toMatch(/LOW RAIN: not scored \(under 10 mm\)/);
    expect(details.textContent).toMatch(/Estimated risk\s*Not scored/);
    expect(details.textContent).toMatch(/Not recorded \(rain was under 10 mm\)/);
    expect(details.textContent).not.toMatch(/%/);
  });
});

describe('Home: navigation', () => {
  it('"Where are you going?" opens trip planning', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: /where are you going/i }));
    expect(screen.getByTestId('loc').dataset.path).toBe('/plan');
  });

  it('Home, Work and recent-trip chips go to /plan with that destination', async () => {
    const work = { label: 'Cyber Hub', lat: 28.4951, lon: 77.0891 };
    const home = { label: 'Sector 29', lat: 28.467, lon: 77.065 };
    profileStore.update({ home, work });
    profileStore.addRecentTrip(home, { label: 'Medanta', lat: 28.4395, lon: 77.0422 });
    const user = userEvent.setup();
    renderHome();
    const chips = within(await screen.findByLabelText(/quick destinations/i));
    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual(['Home', 'Work', 'Medanta']);
    await user.click(chips.getByRole('button', { name: 'Work' }));
    expect(screen.getByTestId('loc').dataset.path).toBe('/plan');
    expect(JSON.parse(screen.getByTestId('loc').dataset.state!)).toEqual({ destination: work });
  });

  it('sends a visitor who has not done setup to the welcome page', async () => {
    profileStore.clear();
    renderHome();
    await waitFor(() => expect(screen.getByTestId('loc').dataset.path).toBe('/welcome'));
    expect(api.getHotspots).not.toHaveBeenCalled();
  });
});
