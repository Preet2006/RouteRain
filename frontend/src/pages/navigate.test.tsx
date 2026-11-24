// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NavMapHandle, NavMapProps } from '@/features/nav/mapTypes';
import { makeDirections, makeRoute } from '@/features/nav/fixtures';
import { compareRows } from '@/features/route/format';

const api = vi.hoisted(() => ({ getRoute: vi.fn(), getDirections: vi.fn(), narrate: vi.fn() }));
vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly kind: string, message: string, readonly status?: number) {
      super(message);
    }
  },
  getRoute: api.getRoute,
  getDirections: api.getDirections,
  narrate: api.narrate,
}));
const hindi = vi.hoisted(() => ({ available: false }));
const speechMock = vi.hoisted(() => ({ speakResult: vi.fn(), stop: vi.fn() }));
vi.mock('@/lib/speech', () => ({
  speech: { isSupported: () => true, hasHindi: async () => hindi.available, speakResult: speechMock.speakResult, speak: async () => true, stop: speechMock.stop, isSpeaking: () => false },
}));

const maps = vi.hoisted(() => ({ updates: [] as { distanceM: number }[], recenter: vi.fn(), fail: null as null | ((r: string) => void), drag: null as null | (() => void), engine: [] as string[] }));
vi.mock('@/features/nav/NavigationMap', () => ({
  NavigationMap: forwardRef<NavMapHandle, NavMapProps>(function NavigationMap(p, ref) {
    useImperativeHandle(ref, () => ({ update: (f) => maps.updates.push({ distanceM: f.distanceM }), recenter: maps.recenter }), []);
    maps.fail = p.onFailed ?? null;
    maps.drag = p.onDragged;
    maps.engine.push('maplibre');
    return <div data-testid="nav-map" data-engine="maplibre" />;
  }),
}));
vi.mock('@/features/nav/FallbackMap', () => ({
  FallbackNavMap: forwardRef<NavMapHandle, NavMapProps>(function FallbackNavMap(p, ref) {
    useImperativeHandle(ref, () => ({ update: (f) => maps.updates.push({ distanceM: f.distanceM }), recenter: maps.recenter }), []);
    maps.drag = p.onDragged;
    maps.engine.push('leaflet');
    return <div data-testid="nav-map" data-engine="leaflet" />;
  }),
}));

import { ApiError } from '@/api/client';
import { profileStore } from '@/lib/storage';
import { NavigationScreen } from '@/pages/Navigate';

const ROUTE = makeRoute();
const DIRS = makeDirections();
const LLM = 'Tanish, the RouteRain route should avoid Rajiv Chowk and save 8 minutes.';

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}
function renderNav(path = '/navigate/abc123abc123') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/navigate/:routeId" element={<><NavigationScreen /><Where /></>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
// Only the animation-frame clock is faked (so the car's drive is deterministic); react-query and the page's own timers
// run for real, which is why every step also yields one real macrotask.
const realSetTimeout = globalThis.setTimeout;
const tick = () => new Promise<void>((r) => realSetTimeout(r, 0));
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await tick();
  });
async function started(path?: string) {
  renderNav(path);
  await screen.findByTestId('nav-screen');
  await advance(50);
}
const said = () => speechMock.speakResult.mock.calls.map((c) => c[0] as string);
const lastDistance = () => maps.updates[maps.updates.length - 1]?.distanceM ?? 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  window.localStorage.clear();
  profileStore.reload();
  profileStore.update({ onboarded: true, name: 'Tanish', voiceOn: true, language: 'en' });
  api.getRoute.mockReset().mockResolvedValue(ROUTE);
  api.getDirections.mockReset().mockImplementation(async (_id: string, which: string) =>
    which === 'normal' ? makeDirections({ which: 'normal', hotspot_events: [{ ...DIRS.hotspot_events[0], avoided: false, passes_through: true }] }) : DIRS);
  api.narrate.mockReset().mockResolvedValue({ text: LLM, source: 'llm', language: 'en', scenario: ROUTE.scenario });
  speechMock.speakResult.mockReset().mockResolvedValue('ended');
  speechMock.stop.mockReset();
  maps.updates.length = 0;
  maps.engine.length = 0;
  maps.recenter.mockReset();
  hindi.available = false;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the navigation screen', () => {
  it('shows the next manoeuvre, the badges, the bars and speaks the summary then the first direction', async () => {
    renderNav();
    expect(screen.getByText('Getting your directions…')).toBeTruthy();
    await screen.findByTestId('nav-screen');
    await advance(50);
    expect(screen.getByTestId('nav-instruction').textContent).toBe('Turn left onto Golf Course Road');
    expect(screen.getByTestId('nav-distance').textContent).toMatch(/^1\.[45] km$/);
    expect(screen.getByText('Simulated drive')).toBeTruthy();
    expect(screen.getByText(/Replay: 7 August 2026 weather/)).toBeTruthy();
    expect(screen.getByTestId('nav-km').textContent).toBe('3.7 km');
    expect(screen.getByTestId('nav-minutes').textContent).toMatch(/^\d+ min$/);
    expect(screen.getByTestId('nav-eta').textContent).toMatch(/\d:\d\d\s?[ap]m/);
    expect(said()[0]).toBe(`${LLM} Head east on Sohna Road.`);
    expect(speechMock.speakResult.mock.calls[0][1]).toBe('en');
    expect(maps.engine[0]).toBe('maplibre');
  });

  it('shows nothing but the navigation screen (no site header or tab bar)', async () => {
    await started();
    expect(document.querySelector('header.rr-header, .rr-shell, nav[aria-label="Main"]')).toBeNull();
  });

  it('feeds the car position to the map every frame and keeps the distance moving forward', async () => {
    await started();
    const n = maps.updates.length;
    await advance(1000);
    expect(maps.updates.length).toBeGreaterThan(n + 40);
    const d = maps.updates.map((u) => u.distanceM);
    expect(d).toEqual([...d].sort((a, b) => a - b));
    expect(d[d.length - 1]).toBeGreaterThan(d[0]);
  });

  it('the banner moves on to each following manoeuvre, then to the arrival', async () => {
    await started();
    fireEvent.click(screen.getByRole('button', { name: '20×' }));
    await advance(6_000); // about 120 s of driving: on Golf Course Road
    expect(screen.getByTestId('nav-instruction').textContent).toBe('Turn right');
    await advance(5_000); // about 220 s: past the second turn
    expect(screen.getByTestId('nav-instruction').textContent).toBe('Turn right onto Short Lane');
    await advance(8_000);
    expect(screen.getByTestId('nav-instruction').textContent).toBe('Arrive at Medanta');
  });

  it('runs to the end: the arrival card carries the route page numbers, avoided hotspots, and saves the trip', async () => {
    await started();
    fireEvent.click(screen.getByRole('button', { name: '20×' }));
    await advance(60_000);
    const card = screen.getByTestId('nav-arrival');
    expect(within(card).getByRole('heading', { name: 'You have arrived' })).toBeTruthy();
    expect(within(card).getByTestId('arrival-time').textContent).toBe(compareRows(ROUTE)[0].routerain);
    expect(within(card).getByTestId('arrival-km').textContent).toBe(compareRows(ROUTE)[1].routerain);
    expect(within(card).getByTestId('arrival-avoided').textContent).toBe('Rajiv Chowk');
    expect(within(card).getByRole('link', { name: 'Plan another trip' }).getAttribute('href')).toBe('/plan');
    expect(within(card).getByText(/simulated drive using 7 August 2026 weather/i)).toBeTruthy();
    expect(said()[said().length - 1]).toBe('You have arrived at Medanta.');
    const trip = profileStore.get().recentTrips[0];
    expect(trip.destination.label).toBe('Medanta');
    expect(lastDistance()).toBeCloseTo(DIRS.total_distance_m, 0);
    // the frame loop has stopped
    const n = maps.updates.length;
    await advance(1000);
    expect(maps.updates.length).toBe(n);
  });

  it('the hotspot alert shows while the car is near it and matches the spoken line', async () => {
    await started();
    fireEvent.click(screen.getByRole('button', { name: '20×' }));
    let alert: HTMLElement | null = null;
    for (let i = 0; i < 400 && !alert; i++) {
      await advance(100);
      alert = screen.queryByTestId('nav-alert');
    }
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('Rajiv Chowk, rated RED, is to your right. Your route keeps you clear of it.');
    expect(said().filter((t) => t.startsWith('Rajiv Chowk, rated RED')).length).toBeLessThanOrEqual(1);
  });

  it('speed selector and pause control the car', async () => {
    await started();
    expect(screen.getByRole('button', { name: '5×' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '1×' }));
    expect(screen.getByRole('button', { name: '1×' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '5×' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await advance(200);
    const frozen = lastDistance();
    await advance(3000);
    expect(lastDistance()).toBe(frozen);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await advance(1500);
    expect(lastDistance()).toBeGreaterThan(frozen);
  });

  it('Mute stops speech and silences the prompts; Unmute brings them back', async () => {
    await started();
    const before = said().length;
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(speechMock.stop).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '20×' }));
    await advance(4_000); // about 80 s of driving, with the first prompts already passed
    expect(said()).toHaveLength(before);
    expect(screen.getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    await advance(40_000);
    expect(said().length).toBeGreaterThan(before);
  });

  it('starts muted when voice is switched off in Settings (and never speaks)', async () => {
    profileStore.update({ voiceOn: false });
    await started();
    fireEvent.click(screen.getByRole('button', { name: '20×' }));
    await advance(60_000);
    expect(speechMock.speakResult).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy();
    expect(screen.getByTestId('nav-arrival')).toBeTruthy(); // the drive still runs
  });

  it('End trip stops the car and the speech and returns to the route page', async () => {
    await started();
    await advance(500);
    speechMock.stop.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'End trip' }));
    expect(speechMock.stop).toHaveBeenCalled();
    expect(screen.getByTestId('where').textContent).toBe('/route/abc123abc123');
    const n = maps.updates.length;
    await advance(2000);
    expect(maps.updates.length).toBe(n);
  });

  it('leaving the page by any route stops the speech and the loop', async () => {
    renderNav();
    await screen.findByTestId('nav-screen');
    await advance(500);
    speechMock.stop.mockClear();
    cleanup();
    expect(speechMock.stop).toHaveBeenCalled();
    const n = maps.updates.length;
    await advance(1000);
    expect(maps.updates.length).toBe(n);
  });

  it('re-centre appears only after the user drags the map, and follows the car again', async () => {
    await started();
    expect(screen.queryByRole('button', { name: 'Re-centre' })).toBeNull();
    act(() => maps.drag?.());
    fireEvent.click(screen.getByRole('button', { name: 'Re-centre' }));
    expect(maps.recenter).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Re-centre' })).toBeNull();
  });

  it('switches to the north-up Leaflet map, with a notice, when the vector map fails', async () => {
    await started();
    expect(screen.queryByTestId('nav-fallback-notice')).toBeNull();
    act(() => maps.fail?.('style'));
    await advance(100);
    expect(screen.getByTestId('nav-map').getAttribute('data-engine')).toBe('leaflet');
    expect(screen.getByTestId('nav-fallback-notice').textContent).toMatch(/north-up map/);
    const n = maps.updates.length;
    await advance(500);
    expect(maps.updates.length).toBeGreaterThan(n); // the car keeps moving on the fallback map
  });

  it('offers "Tap to enable voice" when the browser blocks speech, and speaks once it is tapped', async () => {
    speechMock.speakResult.mockResolvedValue('blocked');
    await started();
    const tap = screen.getByRole('button', { name: 'Tap to enable voice' });
    speechMock.speakResult.mockResolvedValue('ended');
    const calls = speechMock.speakResult.mock.calls.length;
    fireEvent.click(tap);
    expect(speechMock.speakResult.mock.calls.length).toBe(calls + 1);
    expect(screen.queryByRole('button', { name: 'Tap to enable voice' })).toBeNull();
  });

  it('"Preview the usual route" uses the usual route, says so, and never claims avoided hotspots', async () => {
    await started('/navigate/abc123abc123?which=normal');
    expect(api.getDirections).toHaveBeenCalledWith('abc123abc123', 'normal');
    expect(screen.getByText('Preview: usual route')).toBeTruthy();
    expect(said()[0]).toBe('This is a preview of the usual route. Head east on Sohna Road.');
    expect(api.narrate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '20×' }));
    await advance(60_000);
    expect(screen.getByTestId('arrival-time').textContent).toBe(compareRows(ROUTE)[0].usual);
    expect(screen.getByTestId('arrival-km').textContent).toBe(compareRows(ROUTE)[1].usual);
    expect(screen.getByTestId('arrival-avoided').textContent).toBe('None');
    expect(said().some((t) => t.includes('keeps you clear'))).toBe(false);
  });

  it('falls back to the standard advice sentence when the AI phrasing fails or is slow', async () => {
    api.narrate.mockRejectedValue(new Error('down'));
    await started();
    expect(said()[0]).toBe(`${ROUTE.template_advice} Head east on Sohna Road.`);
    cleanup();
    speechMock.speakResult.mockClear();
    api.narrate.mockReturnValue(new Promise(() => {})); // never answers
    renderNav();
    await advance(300);
    expect(screen.queryByTestId('nav-screen')).toBeNull(); // still waiting for the summary
    await screen.findByTestId('nav-screen', {}, { timeout: 4000 }); // gives up after 2.5 s
    await advance(50);
    expect(said()[0]).toBe(`${ROUTE.template_advice} Head east on Sohna Road.`);
  });

  it('a Hindi preference without a Hindi voice on the device is spoken in English', async () => {
    profileStore.update({ language: 'hi' });
    hindi.available = false;
    await started();
    expect(speechMock.speakResult.mock.calls[0][1]).toBe('en');
    expect(said()[0]).toMatch(/Head east on Sohna Road\.$/);
  });

  it('Hindi with a Hindi voice speaks only Hindi templates (the English summary is left out)', async () => {
    profileStore.update({ language: 'hi' });
    hindi.available = true;
    api.narrate.mockResolvedValue({ text: 'यह मार्ग राजीव चौक से बचता है।', source: 'template', language: 'hi', scenario: ROUTE.scenario });
    await started();
    expect(speechMock.speakResult.mock.calls[0][1]).toBe('hi');
    expect(said()[0]).toBe('यह मार्ग राजीव चौक से बचता है। Sohna Road पर पूर्व की ओर चलें।');
    fireEvent.click(screen.getByRole('button', { name: '20×' }));
    await advance(60_000);
    expect(said().filter((t) => t.startsWith('अब ')).length).toBe(3);
    expect(said()[said().length - 1]).toBe('आप Medanta पहुँच गए हैं।');
  });

  it('shows the server\'s message when the route has expired, with a way back', async () => {
    api.getDirections.mockRejectedValue(new ApiError('http', 'This route has expired, please plan it again.', 404));
    renderNav();
    expect((await screen.findByRole('alert')).textContent).toContain('This route has expired, please plan it again.');
    expect(screen.getByRole('link', { name: 'Plan it again' }).getAttribute('href')).toBe('/plan');
    expect(speechMock.speakResult).not.toHaveBeenCalled();
  });

  it('shows a clear message when the server cannot be reached', async () => {
    api.getRoute.mockRejectedValue(new Error('offline'));
    renderNav();
    expect((await screen.findByRole('alert')).textContent).toContain("Can't reach the RouteRain server.");
  });
});
