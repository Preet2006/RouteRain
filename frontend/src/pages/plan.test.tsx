// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ createRoute: vi.fn(), searchPlaces: vi.fn(), geocodePlace: vi.fn(), getRoute: vi.fn() }));
vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly kind: string, message: string) {
      super(message);
    }
  },
  createRoute: api.createRoute,
  searchPlaces: api.searchPlaces,
  geocodePlace: api.geocodePlace,
  getRoute: api.getRoute,
}));
const geo = vi.hoisted(() => ({ locate: vi.fn() }));
vi.mock('@/lib/geolocation', async (orig) => ({ ...(await orig<typeof import('@/lib/geolocation')>()), locate: geo.locate }));
// Leaflet needs real layout: the pick map is replaced by a stub that exposes "click the map".
vi.mock('@/features/plan/PickMap', () => ({
  PickMap: (p: { from: { label: string } | null; to: { label: string } | null; picking: string | null; onPick: (a: number, b: number) => void }) => (
    <div data-testid="pick-map" data-picking={p.picking ?? ''} data-from={p.from?.label ?? ''} data-to={p.to?.label ?? ''}>
      <button type="button" onClick={() => p.onPick(28.4595, 77.0266)}>simulate map click</button>
    </div>
  ),
}));

import { ApiError } from '@/api/client';
import { LocateError } from '@/lib/geolocation';
import { ScenarioProvider } from '@/lib/scenario';
import { profileStore } from '@/lib/storage';
import { Plan } from '@/pages/Plan';

const PLACES = [
  { place_id: 'P021', name: 'Cyber Hub', category: 'landmark', lat: 28.4951, lon: 77.0891, verified: 0 },
  { place_id: 'P018', name: 'Cyber City Rapid Metro', category: 'metro', lat: 28.4939, lon: 77.0887, verified: 0 },
  { place_id: 'P030', name: 'Medanta The Medicity', category: 'hospital', lat: 28.4395, lon: 77.0422, verified: 0 },
];

function Probe() {
  const l = useLocation();
  return <div data-testid="loc" data-path={l.pathname} />;
}
function renderPlan(state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/plan', state }]}>
        <ScenarioProvider>
          <Routes>
            <Route path="/plan" element={<Plan />} />
            <Route path="*" element={<Probe />} />
          </Routes>
        </ScenarioProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const from = () => screen.getByRole('combobox', { name: 'From' }) as HTMLInputElement;
const to = () => screen.getByRole('combobox', { name: 'To' }) as HTMLInputElement;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  profileStore.reload();
  profileStore.update({ onboarded: true });
  api.searchPlaces.mockImplementation(async (q: string) => ({
    query: q, results: PLACES.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())),
  }));
  api.geocodePlace.mockResolvedValue({ lat: 28.47, lon: 77.04, label: 'x' });
  api.createRoute.mockResolvedValue({ route_id: 'abc123abc123' });
  geo.locate.mockResolvedValue({ lat: 28.46, lon: 77.03, accuracyM: 20 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('suggestions and keyboard', () => {
  it('typing "cyber" lists Cyber Hub, and arrow keys + Enter choose it without submitting', async () => {
    const user = userEvent.setup();
    renderPlan();
    await user.type(from(), 'cyber');
    const list = await screen.findByRole('listbox', { name: /from suggestions/i });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Cyber Hublandmark', 'Cyber City Rapid Metrometro']);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(from().getAttribute('aria-activedescendant')).toMatch(/-0$/);
    await user.keyboard('{Enter}');
    expect(from().value).toBe('Cyber Hub');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(api.createRoute).not.toHaveBeenCalled();
    expect(screen.getByText(/saved: 28\.4951, 77\.0891/i)).toBeTruthy();
  });

  it('ArrowUp from nothing wraps to the last option, and Escape closes the list', async () => {
    const user = userEvent.setup();
    renderPlan();
    await user.type(from(), 'cyber');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowUp}'); // nothing active yet: ArrowUp wraps to the last option
    expect(from().getAttribute('aria-activedescendant')).toMatch(/-1$/);
    await user.keyboard('{ArrowDown}'); // and ArrowDown wraps back to the first
    expect(from().getAttribute('aria-activedescendant')).toMatch(/-0$/);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(from().value).toBe('cyber'); // nothing chosen
  });

  it('clicking a suggestion chooses it', async () => {
    const user = userEvent.setup();
    renderPlan();
    await user.type(to(), 'medanta');
    await user.click(await screen.findByRole('option', { name: /medanta/i }));
    expect(to().value).toBe('Medanta The Medicity');
  });
});

describe('choosing places', () => {
  it('prefills "To" from a Home-screen chip', () => {
    renderPlan({ destination: { label: 'Cyber Hub', lat: 28.4951, lon: 77.0891 } });
    expect(to().value).toBe('Cyber Hub');
  });

  it('Home, Work and recent places are one tap away and Swap exchanges the two fields', async () => {
    const home = { label: 'Sector 29', lat: 28.467, lon: 77.065 };
    const work = { label: 'Cyber Hub', lat: 28.4951, lon: 77.0891 };
    profileStore.update({ home, work });
    const user = userEvent.setup();
    renderPlan();
    await user.click(within(screen.getByRole('group', { name: /saved places for from/i })).getByRole('button', { name: 'Home' }));
    await user.click(within(screen.getByRole('group', { name: /saved places for to/i })).getByRole('button', { name: 'Work' }));
    expect([from().value, to().value]).toEqual(['Sector 29', 'Cyber Hub']);
    await user.click(screen.getByRole('button', { name: /swap/i }));
    expect([from().value, to().value]).toEqual(['Cyber Hub', 'Sector 29']);
  });

  it('"Use my location" fills the field, and explains a refusal in plain words', async () => {
    const user = userEvent.setup();
    renderPlan();
    await user.click(within(from().closest('.rr-field') as HTMLElement).getByRole('button', { name: /use my location/i }));
    await waitFor(() => expect(from().value).toBe('My location (28.4600, 77.0300)'));

    geo.locate.mockRejectedValueOnce(new LocateError('denied', 'Location is blocked for this site. Allow it from the lock icon.'));
    await user.click(within(to().closest('.rr-field') as HTMLElement).getByRole('button', { name: /use my location/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/blocked for this site/i);
    expect(to().value).toBe('');
  });

  it('"Pick on map" turns picking on for that field, a map click sets it, and picking turns off', async () => {
    const user = userEvent.setup();
    renderPlan();
    const toField = to().closest('.rr-field') as HTMLElement;
    await user.click(within(toField).getByRole('button', { name: /pick on map/i }));
    expect(screen.getByTestId('pick-map').dataset.picking).toBe('to');
    expect(within(toField).getByRole('button', { name: /cancel picking/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /simulate map click/i }));
    expect(to().value).toBe('Pinned location (28.4595, 77.0266)');
    expect(screen.getByTestId('pick-map').dataset.picking).toBe('');
  });

  it('a map click while not picking changes nothing', async () => {
    const user = userEvent.setup();
    renderPlan();
    await user.click(screen.getByRole('button', { name: /simulate map click/i }));
    expect([from().value, to().value]).toEqual(['', '']);
  });

  it('the full-map search is a separate, explicit action', async () => {
    const user = userEvent.setup();
    renderPlan();
    await user.type(from(), 'Some Odd Place');
    expect(api.geocodePlace).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /search the full map for/i }));
    await waitFor(() => expect(api.geocodePlace).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/saved: 28\.4700, 77\.0400/i)).toBeTruthy();
  });
});

describe('finding routes', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(from(), 'cyber');
    await user.click(await screen.findByRole('option', { name: /^cyber hub/i }));
    await user.type(to(), 'medanta');
    await user.click(await screen.findByRole('option', { name: /medanta/i }));
  }

  it('is disabled until both places are chosen', async () => {
    const user = userEvent.setup();
    renderPlan();
    const button = screen.getByRole('button', { name: 'Find routes' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.type(from(), 'cyber');
    await user.click(await screen.findByRole('option', { name: /^cyber hub/i }));
    expect(button.disabled).toBe(true);
    await user.type(to(), 'medanta');
    await user.click(await screen.findByRole('option', { name: /medanta/i }));
    expect(button.disabled).toBe(false);
  });

  it('plans for the live forecast with the saved caution, saves the trip and opens the result', async () => {
    profileStore.update({ caution: 'balanced' });
    const user = userEvent.setup();
    renderPlan();
    expect(screen.getByRole('status').textContent).toMatch(/live forecast/i);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Find routes' }));
    await waitFor(() => expect(screen.getByTestId('loc').dataset.path).toBe('/route/abc123abc123'));
    expect(api.createRoute).toHaveBeenCalledWith({
      origin: { lat: 28.4951, lon: 77.0891, label: 'Cyber Hub' },
      destination: { lat: 28.4395, lon: 77.0422, label: 'Medanta The Medicity' },
      caution: 'balanced', mode: 'live', date: null,
    });
    expect(profileStore.get().recentTrips[0]).toMatchObject({ origin: { label: 'Cyber Hub' }, destination: { label: 'Medanta The Medicity' } });
  });

  it('plans for the replay day on screen and says so', async () => {
    window.sessionStorage.setItem('routerain.scenario', JSON.stringify({ mode: 'replay', date: '2026-08-07' }));
    const user = userEvent.setup();
    renderPlan();
    expect(screen.getByRole('status').textContent).toMatch(/replay: 7 august 2026 weather/i);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Find routes' }));
    await waitFor(() => expect(api.createRoute).toHaveBeenCalled());
    expect(api.createRoute.mock.calls[0][0]).toMatchObject({ mode: 'replay', date: '2026-08-07' });
  });

  it.each([
    ["That point is outside RouteRain's Gurugram coverage."],
    ['No drivable route found between these points.'],
    ["Can't reach the RouteRain server."],
  ])('shows the API message inline and stays on the page: %s', async (message) => {
    api.createRoute.mockRejectedValueOnce(new ApiError('http', message));
    const user = userEvent.setup();
    renderPlan();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Find routes' }));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.queryByTestId('loc')).toBeNull();
    expect((screen.getByRole('button', { name: 'Find routes' }) as HTMLButtonElement).disabled).toBe(false); // can retry
    expect(profileStore.get().recentTrips).toHaveLength(0); // a failed trip is not saved
  });

  it('refuses identical pickup and drop without calling the server', async () => {
    const user = userEvent.setup();
    renderPlan();
    await user.type(from(), 'cyber');
    await user.click(await screen.findByRole('option', { name: /^cyber hub/i }));
    await user.type(to(), 'cyber');
    await user.click((await screen.findAllByRole('option', { name: /^cyber hub/i }))[0]);
    await user.click(screen.getByRole('button', { name: 'Find routes' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/same place/i);
    expect(api.createRoute).not.toHaveBeenCalled();
  });

  it('shows a busy state while the route is being found', async () => {
    api.createRoute.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderPlan();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Find routes' }));
    const busy = (await screen.findByRole('button', { name: /finding routes/i })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
  });
});
