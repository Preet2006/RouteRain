// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Hotspot, HotspotsResponse } from '@/api/schemas';

const api = vi.hoisted(() => ({ getHotspots: vi.fn() }));
vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly kind: string, message: string) {
      super(message);
    }
  },
  getHotspots: api.getHotspots,
}));

import { ApiError } from '@/api/client';
import { ScenarioProvider, type ScenarioChoice } from '@/lib/scenario';
import { Hotspots } from '@/pages/Hotspots';

const EXPL = (n: string, t: string) => `${n} - ${t} (30% estimated risk). Conditions lean toward elevated risk: the ground is already highly saturated (42% soil moisture). It has flooded on 5 of the last 20 comparable rain days at this location.`;
const spot = (n: number, name: string, tier: Hotspot['tier'], p: number | null, reported: Hotspot['reported_outcome'] = null, type = 'chowk/underpass'): Hotspot => ({
  id: `H${String(n).padStart(2, '0')}`, name, lat: 28.4 + n / 100, lon: 77 + n / 100, tier, probability: p,
  explanation: tier === 'LOW_RAIN' ? `${name}: LOW RAIN: not scored.` : EXPL(name, tier), reported_outcome: reported, type,
});
const TWELVE: Hotspot[] = [
  spot(1, 'Bilaspur Chowk', 'RED', 0.5687, 'no_report', 'chowk/highway'), spot(2, 'Rajiv Chowk', 'RED', 0.3889, 'flooded'), spot(3, 'Hero Honda Chowk', 'RED', 0.3925, 'no_report'),
  spot(4, 'Narsingpur', 'RED', 0.3908, 'no_report', 'low-lying highway stretch'), spot(5, 'IFFCO Chowk', 'YELLOW', 0.2494, 'flooded'), spot(6, 'Basai Chowk', 'RED', 0.3714, 'no_report', 'chowk'),
  spot(7, 'Subhash Chowk', 'YELLOW', 0.2808, 'no_report', 'chowk'), spot(8, 'Sohna Road', 'RED', 0.3402, 'flooded', 'arterial road'), spot(9, 'Golf Course Road', 'YELLOW', 0.1549, 'no_report', 'arterial road'),
  spot(10, 'Sheetla Mata Road', 'RED', 0.8331, 'flooded', 'road'), spot(11, 'Sadar Bazaar', 'GREEN', 0.0375, 'no_report', 'market area'), spot(12, 'Artemis Road', 'LOW_RAIN', null, null, 'road near hospital'),
];
const resp = (hotspots: Hotspot[], scenario: HotspotsResponse['scenario']): HotspotsResponse => {
  const tiers = { RED: 0, YELLOW: 0, GREEN: 0, LOW_RAIN: 0 };
  hotspots.forEach((h) => (tiers[h.tier] += 1));
  return { scenario, tiers, hotspots };
};
const REPLAY = resp(TWELVE, { mode: 'replay', date: '2026-08-07', forecast_generated_at: null });
const LIVE = resp(TWELVE.map((h) => ({ ...h, tier: 'GREEN' as const, probability: 0.03, reported_outcome: null })), { mode: 'live', date: null, forecast_generated_at: '2026-11-24T10:30:00+00:00' });

function Probe() {
  const l = useLocation();
  return <div data-testid="loc" data-path={l.pathname + l.search} />;
}
function renderPage(initial?: ScenarioChoice, url = '/hotspots') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <ScenarioProvider initial={initial}>
          <Routes>
            <Route path="/hotspots" element={<><Hotspots /><Probe /></>} />
            <Route path="*" element={<Probe />} />
          </Routes>
        </ScenarioProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const REPLAY_CHOICE: ScenarioChoice = { mode: 'replay', date: '2026-08-07' };
const cards = () => within(screen.getByRole('list', { name: 'Hotspots' })).getAllByRole('listitem');
const names = () => cards().map((c) => c.querySelector('h2')!.textContent);

beforeEach(() => {
  api.getHotspots.mockImplementation(async (mode: string) => (mode === 'live' ? LIVE : REPLAY));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Hotspots page: cards', () => {
  it('shows all 12 hotspots as cards with tier word and icon, name, area, risk, one reason and a button', async () => {
    renderPage(REPLAY_CHOICE);
    await screen.findByRole('list', { name: 'Hotspots' });
    expect(cards()).toHaveLength(12);
    const sheetla = cards().find((c) => c.textContent!.includes('Sheetla Mata Road'))!;
    expect(sheetla.querySelector('.rr-tier')!.textContent).toBe('✕ RED');
    expect(sheetla.textContent).toContain('Road'); // area from the type
    expect(sheetla.textContent).toContain('about 80 to 85%');
    expect(sheetla.textContent).toMatch(/Conditions lean toward elevated risk: the ground is already highly saturated/);
    expect(sheetla.textContent).not.toMatch(/It has flooded on 5 of/); // only the first reason
    expect(sheetla.querySelector('.rr-hcard-strip')).toBeTruthy();
    const link = within(sheetla).getByRole('link', { name: 'View in detail: Sheetla Mata Road' });
    expect(link.textContent).toBe('View in detail');
    expect(link.getAttribute('aria-label')).toContain(link.textContent); // visible text is part of the accessible name
  });

  it('every card uses a tier word as well as the colour strip', async () => {
    renderPage(REPLAY_CHOICE);
    await screen.findByRole('list', { name: 'Hotspots' });
    for (const c of cards()) expect(c.querySelector('.rr-tier')!.textContent).toMatch(/(RED|YELLOW|GREEN|LOW RAIN)$/);
  });

  it('a LOW RAIN card says it is not scored and has no percentage', async () => {
    renderPage(REPLAY_CHOICE);
    await screen.findByRole('list', { name: 'Hotspots' });
    const low = cards().find((c) => c.textContent!.includes('Artemis Road'))!;
    expect(low.querySelector('.rr-tier')!.textContent).toBe('– LOW RAIN');
    expect(low.textContent).toContain('Not scored, under 10 mm rain');
    expect(low.textContent).not.toMatch(/%/);
  });

  it('replay cards show what was reported that day, separately; live cards do not', async () => {
    renderPage(REPLAY_CHOICE);
    await screen.findByRole('list', { name: 'Hotspots' });
    expect(cards().find((c) => c.textContent!.includes('Rajiv Chowk'))!.textContent).toMatch(/Reported that day:\s*Flooded/);
    expect(cards().find((c) => c.textContent!.includes('Bilaspur'))!.textContent).toMatch(/Reported that day:\s*No report/);
    cleanup();
    renderPage();
    await screen.findByRole('list', { name: 'Hotspots' });
    expect(document.body.textContent).not.toMatch(/Reported that day/);
  });
});

describe('Hotspots page: filters and sort', () => {
  it('chips show counts; All is selected by default; sorted by risk (RED first, highest probability first)', async () => {
    renderPage(REPLAY_CHOICE);
    await screen.findByRole('list', { name: 'Hotspots' });
    const chips = within(screen.getByRole('group', { name: 'Filter by risk' }));
    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual(['All 12', 'RED 7', 'YELLOW 3', 'GREEN 1', 'LOW RAIN 1']);
    expect(chips.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true');
    expect(names()[0]).toBe('Sheetla Mata Road');
    expect(names().slice(-2)).toEqual(['Sadar Bazaar', 'Artemis Road']);
  });

  it('filters by tier and updates the address so the view can be shared', async () => {
    const user = userEvent.setup();
    renderPage(REPLAY_CHOICE);
    await screen.findByRole('list', { name: 'Hotspots' });
    await user.click(screen.getByRole('button', { name: /^YELLOW/ }));
    expect(names()).toEqual(['Subhash Chowk', 'IFFCO Chowk', 'Golf Course Road']);
    expect(screen.getByRole('button', { name: /^YELLOW/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('loc').dataset.path).toBe('/hotspots?tier=YELLOW');
    await user.click(screen.getByRole('button', { name: /^All/ }));
    expect(cards()).toHaveLength(12);
    expect(screen.getByTestId('loc').dataset.path).toBe('/hotspots');
  });

  it('sorts by name A to Z', async () => {
    const user = userEvent.setup();
    renderPage(REPLAY_CHOICE);
    await screen.findByRole('list', { name: 'Hotspots' });
    await user.selectOptions(screen.getByLabelText('Sort hotspots'), 'name');
    expect(names()[0]).toBe('Artemis Road');
    expect(names()).toEqual([...names()].sort((a, b) => a!.localeCompare(b!)));
    expect(screen.getByTestId('loc').dataset.path).toBe('/hotspots?sort=name');
  });

  it('opens already filtered and sorted from the address', async () => {
    renderPage(REPLAY_CHOICE, '/hotspots?tier=RED&sort=name');
    await screen.findByRole('list', { name: 'Hotspots' });
    expect(cards()).toHaveLength(7);
    expect(names()[0]).toBe('Basai Chowk');
    expect((screen.getByLabelText('Sort hotspots') as HTMLSelectElement).value).toBe('name');
  });

  it('ignores a nonsense filter in the address', async () => {
    renderPage(REPLAY_CHOICE, '/hotspots?tier=PURPLE&sort=chaos');
    await screen.findByRole('list', { name: 'Hotspots' });
    expect(cards()).toHaveLength(12);
  });

  it('an empty filter explains itself and offers Show all', async () => {
    const user = userEvent.setup();
    api.getHotspots.mockResolvedValue(resp(TWELVE.filter((h) => h.tier !== 'GREEN'), REPLAY.scenario));
    renderPage(REPLAY_CHOICE, '/hotspots?tier=GREEN');
    expect(await screen.findByText(/no hotspots match this filter/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(cards()).toHaveLength(11);
  });
});

describe('Hotspots page: weather, loading and errors', () => {
  it('live: forecast time, and the no-rain note when nothing is at risk', async () => {
    renderPage();
    expect(await screen.findByText(/forecast updated/i)).toBeTruthy();
    expect(screen.getByText(/no rain is forecast, so every hotspot is green/i)).toBeTruthy();
    expect(screen.queryByText(/replay:/i)).toBeNull();
    expect(api.getHotspots).toHaveBeenCalledWith('live', null);
  });

  it('replay: a dated banner and that day is requested', async () => {
    renderPage(REPLAY_CHOICE);
    expect((await screen.findByText(/replay: 7 august 2026 weather/i)).closest('[role=status]')!.textContent).toMatch(/not today.s forecast/i);
    expect(api.getHotspots).toHaveBeenCalledWith('replay', '2026-08-07');
    expect(screen.queryByText(/no rain is forecast/i)).toBeNull();
  });

  it('detail links keep the replay day in the address so a refresh stays on it', async () => {
    renderPage(REPLAY_CHOICE);
    await screen.findByRole('list', { name: 'Hotspots' });
    expect(screen.getByRole('link', { name: 'View in detail: Rajiv Chowk' }).getAttribute('href')).toBe('/hotspots/H02?replay=2026-08-07');
    cleanup();
    renderPage();
    await screen.findByRole('list', { name: 'Hotspots' });
    expect(screen.getByRole('link', { name: 'View in detail: Rajiv Chowk' }).getAttribute('href')).toBe('/hotspots/H02');
  });

  it('shows skeleton cards with the slow-first-load note while loading', async () => {
    api.getHotspots.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByLabelText(/loading hotspots/i)).toBeTruthy();
    expect(screen.getByText(/can take up to 30 seconds/i)).toBeTruthy();
  });

  it("shows \"Can't reach RouteRain server\" with a Retry that works", async () => {
    api.getHotspots.mockRejectedValueOnce(new ApiError('network', "Can't reach the RouteRain server."));
    const user = userEvent.setup();
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/can't reach routerain server/i);
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Hotspots' })).toBeTruthy();
  });

  it('shows the server message for other errors', async () => {
    api.getHotspots.mockRejectedValueOnce(new ApiError('http', 'Project data is incomplete. Check the model and data files.'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toMatch(/hotspots could not be loaded.*project data is incomplete/i);
  });
});
