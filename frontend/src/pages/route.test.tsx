// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RouteResponse } from '@/api/schemas';

const api = vi.hoisted(() => ({ getRoute: vi.fn(), narrate: vi.fn() }));
vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly kind: string, message: string) {
      super(message);
    }
  },
  getRoute: api.getRoute,
  narrate: api.narrate,
}));
const hindi = vi.hoisted(() => ({ available: false }));
const speechMock = vi.hoisted(() => ({
  speakResult: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('@/lib/speech', () => ({
  speech: {
    isSupported: () => true,
    hasHindi: async () => hindi.available,
    speakResult: speechMock.speakResult,
    speak: async () => true,
    stop: speechMock.stop,
    isSpeaking: () => false,
  },
}));
// Leaflet needs real layout; the map is covered in features/route/RouteMap.test.tsx.
vi.mock('@/features/route/RouteMap', () => ({ RouteMap: (p: { route: RouteResponse }) => <div data-testid="map" data-id={p.route.route_id} /> }));

import { ApiError } from '@/api/client';
import { resetAdviceMemory } from '@/features/route/useAdvice';
import { profileStore } from '@/lib/storage';
import { RouteResult } from '@/pages/RouteResult';

const TEMPLATE = 'On 7 August 2026, this route adds about 1 minute of driving but is expected to save about 8 minutes overall by avoiding Rajiv Chowk (RED).';
const LLM = 'Tanish, on 7 August 2026, the RouteRain route should avoid Rajiv Chowk and save 8 minutes, adding 1 minute of driving.';

const leg = (t: number, km: number, e: number, near: RouteResponse['normal_route']['near_hotspots']) =>
  ({ polyline: [[28.49, 77.08], [28.44, 77.04]] as [number, number][], drive_time_min: t, distance_km: km, near_hotspots: near, expected_time_min: e });
const RED_H02 = { id: 'H02', name: 'Rajiv Chowk', tier: 'RED' as const, probability: 0.3889 };
const BASE: RouteResponse = {
  route_id: 'abc123abc123',
  scenario: { mode: 'replay', date: '2026-08-07', forecast_generated_at: null },
  origin: { lat: 28.4951, lon: 77.0891, label: 'Cyber Hub' },
  destination: { lat: 28.4395, lon: 77.0422, label: 'Medanta' },
  caution: 'cautious',
  normal_route: leg(7.8, 8.94, 16.9, [RED_H02]),
  flood_aware_route: leg(8.8, 8.8, 8.8, []),
  identical_routes: false,
  expected_saving_min: 8.1, added_drive_min: 1.1, flood_delay_min: 23.4,
  avoided_hotspots: [{ ...RED_H02, explanation: 'Rajiv Chowk - RED (39% estimated risk). It has flooded on 20 of the last 60 comparable rain days.' }],
  still_passes_through: [],
  risk_zones: [{ id: 'H02', name: 'Rajiv Chowk', lat: 28.447, lon: 77.032, tier: 'RED', radius_m: 500 }],
  template_advice: TEMPLATE,
};

function renderRoute(id = 'abc123abc123') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/route/${id}`]}>
        <Routes>
          <Route path="/route/:routeId" element={<RouteResult />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const advice = () => screen.getByTestId('advice-text').textContent;
const llmReply = (text = LLM) => ({ text, source: 'llm', language: 'en', scenario: BASE.scenario });
const standardReply = (text = TEMPLATE) => ({ text, source: 'template', language: 'en', scenario: BASE.scenario });

beforeEach(() => {
  resetAdviceMemory();
  window.localStorage.clear();
  profileStore.reload();
  profileStore.update({ onboarded: true, name: 'Tanish Sharma', voiceOn: true, language: 'en' });
  hindi.available = false;
  api.getRoute.mockResolvedValue(BASE);
  api.narrate.mockResolvedValue(llmReply());
  speechMock.speakResult.mockResolvedValue('ended');
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'userActivation');
});

describe('route result: content', () => {
  it('shows the replay banner, the comparison with backend numbers, the saving and the reasons', async () => {
    renderRoute();
    expect(await screen.findByText(/replay: 7 august 2026 weather/i)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Cyber Hub.*Medanta/);
    expect(screen.getByTestId('map').dataset.id).toBe('abc123abc123');

    const table = screen.getByRole('table');
    const cells = (row: string) => within(within(table).getByRole('row', { name: new RegExp(row, 'i') })).getAllByRole('cell').map((c) => c.textContent);
    expect(cells('Drive time')).toEqual(['8 min', '9 min']);
    expect(cells('Distance')).toEqual(['8.9 km', '8.8 km']);
    expect(cells('Hotspots passed')).toEqual(['Rajiv Chowk (RED)', 'None']);
    expect(cells('flood risk')).toEqual(['17 min', '9 min']);
    expect(screen.getByText(/expected time saved:/i).parentElement!.textContent).toMatch(/about 8 minutes overall/);

    const why = screen.getByRole('heading', { name: 'Why' }).closest('section')!;
    expect(why.textContent).toMatch(/Avoided Rajiv Chowk\./);
    expect(why.textContent).toMatch(/flooded on 20 of the last 60 comparable rain days/); // visible without a click
    expect(screen.getByRole('list', { name: /map legend/i }).textContent).toMatch(/usual route.*dashed.*routerain route.*red zone \(500 m\)/is);
    expect(document.body.textContent).toMatch(/assumed 23\.4 minute delay/);
  });

  it('remembers the trip, once the route has loaded', async () => {
    renderRoute();
    await screen.findByTestId('advice-text');
    expect(profileStore.get().recentTrips[0]).toMatchObject({ origin: { label: 'Cyber Hub' }, destination: { label: 'Medanta' } });
  });

  it('identical routes: says no detour is needed and nothing is avoided', async () => {
    const route: RouteResponse = {
      ...BASE, identical_routes: true, expected_saving_min: 0, added_drive_min: 0, avoided_hotspots: [], risk_zones: [],
      normal_route: leg(11.6, 9.7, 11.6, []), flood_aware_route: leg(11.6, 9.7, 11.6, []),
      scenario: { mode: 'live', date: null, forecast_generated_at: 'x' },
      template_advice: 'No detour needed today: your direct route doesn\'t pass near any RED or YELLOW hotspot.',
    };
    api.getRoute.mockResolvedValue(route);
    api.narrate.mockResolvedValue(standardReply(route.template_advice));
    renderRoute();
    await waitFor(() => expect(advice()).toMatch(/^No detour needed today/));
    expect(screen.getByText(/both routes are the same, so there is nothing to avoid/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Why' })).toBeNull();
    expect(screen.queryByText(/replay:/i)).toBeNull();
    await waitFor(() => expect(speechMock.speakResult).toHaveBeenCalledWith(route.template_advice, 'en'));
  });

  it('a detour that costs more than it saves never uses the word save anywhere on the page', async () => {
    const text = 'This detour avoids Rajiv Chowk (RED) but adds about 4 minutes of driving, more than the flood delay it is expected to avoid. It\'s your call.';
    const route: RouteResponse = { ...BASE, expected_saving_min: -2.1, added_drive_min: 4.2, template_advice: text, normal_route: leg(7.8, 8.9, 9.0, [RED_H02]) };
    api.getRoute.mockResolvedValue(route);
    api.narrate.mockResolvedValue(standardReply(text));
    renderRoute();
    await waitFor(() => expect(advice()).toBe(text));
    expect(screen.getByText(/net effect:/i).parentElement!.textContent).toMatch(/adds about 4 minutes of driving/);
    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/\bsav(e|es|ed|ing)\b/i);
  });

  it('lists a hotspot the route still passes, honestly', async () => {
    api.getRoute.mockResolvedValue({ ...BASE, still_passes_through: [{ ...RED_H02, id: 'H09', name: 'Golf Course Road', explanation: 'Golf Course Road - RED.' }] });
    renderRoute();
    expect((await screen.findByText(/still passes near golf course road/i)).closest('li')!.textContent).toMatch(/no other road avoids it/i);
  });
});

describe('route result: voice', () => {
  it('shows the standard line at once, then speaks and shows the AI-phrased line as the SAME text', async () => {
    let release!: (v: unknown) => void;
    api.narrate.mockReturnValueOnce(new Promise((r) => (release = r)));
    renderRoute();
    await screen.findByTestId('advice-text');
    expect(advice()).toBe(TEMPLATE); // the standard line is there before the AI line arrives
    expect(speechMock.speakResult).not.toHaveBeenCalled(); // and nothing is spoken until the AI line (or the wait) is done
    await act(async () => release(llmReply()));
    await waitFor(() => expect(speechMock.speakResult).toHaveBeenCalledTimes(1));
    expect(speechMock.speakResult).toHaveBeenCalledWith(LLM, 'en');
    expect(advice()).toBe(LLM);
    expect(document.querySelector('.rr-source')!.textContent).toBe('AI-phrased');
    expect(api.narrate).toHaveBeenCalledWith({ route_id: 'abc123abc123', user_name: 'Tanish', language: 'en' }); // first name only
  });

  it('LLM problems fall back silently to the standard line, tagged Standard, and still speak it', async () => {
    api.narrate.mockRejectedValue(new ApiError('http', 'boom'));
    renderRoute();
    await waitFor(() => expect(speechMock.speakResult).toHaveBeenCalledWith(TEMPLATE, 'en'));
    expect(document.querySelector('.rr-source')!.textContent).toBe('Standard');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('speaks only once per route, even if the page re-renders', async () => {
    const { rerender } = renderRoute();
    await waitFor(() => expect(speechMock.speakResult).toHaveBeenCalledTimes(1));
    profileStore.update({ caution: 'balanced' }); // unrelated change re-renders the page
    rerender(<div />);
    expect(speechMock.speakResult).toHaveBeenCalledTimes(1);
  });

  it('after 7 seconds without an AI line it reads the standard one, and a late AI line does not change what was read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let release!: (v: unknown) => void;
    api.narrate.mockReturnValue(new Promise((r) => (release = r)));
    renderRoute();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(speechMock.speakResult).not.toHaveBeenCalled();
    expect(screen.getByText(/preparing voice advice/i)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    expect(speechMock.speakResult).toHaveBeenCalledWith(TEMPLATE, 'en');
    await act(async () => { release(llmReply()); await vi.advanceTimersByTimeAsync(50); });
    expect(advice()).toBe(TEMPLATE); // frozen: what you read is what you heard
    expect(speechMock.speakResult).toHaveBeenCalledTimes(1);
  });

  it('offers Play advice when the browser blocks automatic speech, and plays on click', async () => {
    speechMock.speakResult.mockResolvedValueOnce('blocked').mockResolvedValue('ended');
    renderRoute();
    expect((await screen.findByRole('note')).textContent).toMatch(/blocked automatic voice/i);
    fireEvent.click(screen.getByRole('button', { name: 'Play advice' }));
    await waitFor(() => expect(speechMock.speakResult).toHaveBeenCalledTimes(2));
    expect(speechMock.speakResult).toHaveBeenLastCalledWith(LLM, 'en');
  });

  it('does not even try when the browser reports no user interaction yet, and shows Play advice', async () => {
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { hasBeenActive: false } });
    renderRoute();
    expect((await screen.findByRole('note')).textContent).toMatch(/blocked automatic voice/i);
    expect(speechMock.speakResult).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play advice' })).toBeTruthy();
  });

  it('with voice turned off nothing plays by itself, but Play advice is there', async () => {
    profileStore.update({ voiceOn: false });
    renderRoute();
    await screen.findByTestId('advice-text');
    await waitFor(() => expect(advice()).toBe(LLM));
    expect(speechMock.speakResult).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play advice' }));
    await waitFor(() => expect(speechMock.speakResult).toHaveBeenCalledWith(LLM, 'en'));
  });

  it('Stop interrupts speech, then Play again speaks it again', async () => {
    let finish!: (v: string) => void;
    speechMock.speakResult.mockReturnValueOnce(new Promise((r) => (finish = r))).mockResolvedValue('ended');
    renderRoute();
    const stop = await screen.findByRole('button', { name: 'Stop' });
    expect(screen.getByText(/speaking…/i)).toBeTruthy();
    fireEvent.click(stop);
    expect(speechMock.stop).toHaveBeenCalled();
    await act(async () => finish('interrupted'));
    const again = await screen.findByRole('button', { name: 'Play again' });
    fireEvent.click(again);
    await waitFor(() => expect(speechMock.speakResult).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull(); // a user stop is not an error
  });

  it('stops speaking when you leave the page', async () => {
    const { unmount } = renderRoute();
    await waitFor(() => expect(speechMock.speakResult).toHaveBeenCalled());
    speechMock.stop.mockClear();
    unmount();
    expect(speechMock.stop).toHaveBeenCalled();
  });

  it('says so when the voice fails, and when the browser cannot speak', async () => {
    speechMock.speakResult.mockResolvedValueOnce('failed');
    renderRoute();
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not play/i);
    cleanup();
    resetAdviceMemory();
    speechMock.speakResult.mockResolvedValueOnce('unsupported');
    renderRoute();
    expect((await screen.findByRole('note')).textContent).toMatch(/can.t speak/i);
  });

  it('Hindi: asks for Hindi only when the device has a Hindi voice, otherwise English', async () => {
    profileStore.update({ language: 'hi' });
    hindi.available = false;
    renderRoute();
    await waitFor(() => expect(api.narrate).toHaveBeenCalled());
    expect(api.narrate.mock.calls[0][0].language).toBe('en');
    cleanup();
    resetAdviceMemory();
    vi.clearAllMocks();
    api.getRoute.mockResolvedValue(BASE);
    api.narrate.mockResolvedValue({ ...llmReply('७ अगस्त २०२६ को…'), language: 'hi' });
    speechMock.speakResult.mockResolvedValue('ended');
    hindi.available = true;
    renderRoute('abc123abc123');
    await waitFor(() => expect(speechMock.speakResult).toHaveBeenCalled());
    expect(api.narrate.mock.calls[0][0].language).toBe('hi');
    expect(speechMock.speakResult).toHaveBeenCalledWith('७ अगस्त २०२६ को…', 'hi');
  });
});

describe('route result: errors', () => {
  it('an expired or unknown route explains and links back to planning, without voice or saving', async () => {
    api.getRoute.mockRejectedValue(new ApiError('http', 'This route has expired, please plan it again.'));
    renderRoute('gone');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/this route has expired, please plan it again/i);
    expect(within(alert).getByRole('link', { name: /plan it again/i }).getAttribute('href')).toBe('/plan');
    expect(speechMock.speakResult).not.toHaveBeenCalled();
    expect(api.narrate).not.toHaveBeenCalled();
    expect(profileStore.get().recentTrips).toHaveLength(0);
  });

  it('shows a loading state first', async () => {
    api.getRoute.mockReturnValue(new Promise(() => {}));
    renderRoute();
    expect(await screen.findByRole('heading', { name: /finding your route/i })).toBeTruthy();
  });
});

describe('route result: starting the trip', () => {
  it('has a large primary "Start trip with RouteRain" button and a smaller "Preview the usual route" link', async () => {
    renderRoute();
    const start = await screen.findByRole('link', { name: 'Start trip with RouteRain' });
    expect(start.getAttribute('href')).toBe('/navigate/abc123abc123');
    expect(start.className).toMatch(/primary/);
    expect(start.className).toMatch(/rr-start-btn/);
    const preview = screen.getByRole('link', { name: 'Preview the usual route' });
    expect(preview.getAttribute('href')).toBe('/navigate/abc123abc123?which=normal');
    expect(preview.className).not.toMatch(/primary/);
  });

  it('sits under the advice, inside the Advice card', async () => {
    renderRoute();
    const start = await screen.findByRole('link', { name: 'Start trip with RouteRain' });
    const card = start.closest('section')!;
    expect(within(card).getByRole('heading', { name: 'Advice' })).toBeTruthy();
    expect(within(card).getByTestId('advice-text')).toBeTruthy();
  });

  it('when both routes are the same there is nothing to preview, so only Start is offered', async () => {
    api.getRoute.mockResolvedValue({ ...BASE, identical_routes: true, avoided_hotspots: [] });
    renderRoute();
    expect(await screen.findByRole('link', { name: 'Start trip with RouteRain' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Preview the usual route' })).toBeNull();
  });
});

describe('route result: the advice is read aloud only once', () => {
  it('coming back to the same route does not read it again automatically, but Play still works', async () => {
    const first = renderRoute();
    await screen.findByTestId('advice-text');
    await waitFor(() => expect(speechMock.speakResult).toHaveBeenCalledTimes(1));
    first.unmount();
    renderRoute(); // e.g. back from the trip screen
    await screen.findByTestId('advice-text');
    await new Promise((r) => setTimeout(r, 150));
    expect(speechMock.speakResult).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('button', { name: /play/i }));
    await waitFor(() => expect(speechMock.speakResult).toHaveBeenCalledTimes(2));
  });
});
