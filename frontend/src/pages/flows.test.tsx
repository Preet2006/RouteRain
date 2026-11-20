// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hindi = vi.hoisted(() => ({ available: false }));
const spoken = vi.hoisted(() => ({ calls: [] as { text: string; lang: string }[], ok: true }));

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly kind: string, message: string) {
      super(message);
    }
  },
  getHealth: vi.fn().mockResolvedValue({
    ok: true, model_loaded: true, graph_loaded: true, llm_available: true, model_file_present: true,
    places: { count: 65, verified: 0 }, flood_delay_min: 23.4, api_version: 'v2',
  }),
  searchPlaces: vi.fn().mockImplementation(async (q: string) => ({
    query: q,
    results: /cyber/i.test(q)
      ? [{ place_id: 'P021', name: 'Cyber Hub', category: 'landmark', lat: 28.4951, lon: 77.0891, verified: 0 }]
      : [],
  })),
  geocodePlace: vi.fn().mockResolvedValue({ lat: 28.47, lon: 77.04, label: 'Somewhere' }),
}));

vi.mock('@/lib/speech', () => ({
  speech: {
    isSupported: () => true,
    hasHindi: async () => hindi.available,
    hasVoice: async () => true,
    loadVoices: async () => [],
    speak: async (text: string, lang: string) => {
      spoken.calls.push({ text, lang });
      return spoken.ok;
    },
    stop: vi.fn(),
    isSpeaking: () => false,
  },
}));

import { App } from '@/App';
import { STORAGE_KEY, profileStore } from '@/lib/storage';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  profileStore.reload();
  hindi.available = false;
  spoken.calls.length = 0;
  spoken.ok = true;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('first visit', () => {
  it('a fresh browser lands on the welcome page', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: /know before you go/i })).toBeTruthy();
  });

  it('after setup, a reload goes straight to Home with the greeting', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('link', { name: /get started/i }));

    expect(await screen.findByText(/step 1 of 3/i)).toBeTruthy();
    await user.type(screen.getByLabelText(/what should we call you/i), 'Tanish');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(/step 2 of 3/i)).toBeTruthy();
    await user.type(screen.getByRole('combobox', { name: /home/i }), 'cyber');
    await user.click(await screen.findByRole('button', { name: /cyber hub/i }));
    expect(screen.getByText(/saved: 28\.4951, 77\.0891/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(/step 3 of 3/i)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /balanced/i }));
    await user.click(screen.getByRole('button', { name: 'Finish' }));

    expect(await screen.findByRole('heading', { name: /good (morning|afternoon|evening), tanish/i })).toBeTruthy();
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(saved).toMatchObject({ name: 'Tanish', onboarded: true, caution: 'balanced', home: { label: 'Cyber Hub' } });

    // "reload": fresh React tree, profile re-read from storage
    cleanup();
    profileStore.reload();
    renderAt('/');
    expect(await screen.findByRole('heading', { name: /good (morning|afternoon|evening), tanish/i })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /know before you go/i })).toBeNull();
  });

  it('Skip setup goes to Home with defaults and keeps nothing else', async () => {
    const user = userEvent.setup();
    renderAt('/setup');
    await user.type(screen.getByLabelText(/what should we call you/i), 'Ignored');
    await user.click(screen.getByRole('button', { name: /skip setup/i }));
    expect(await screen.findByRole('heading', { name: /^good (morning|afternoon|evening)$/i })).toBeTruthy();
    expect(profileStore.get()).toMatchObject({ onboarded: true, name: '' });
  });

  it('an onboarded visitor opening /welcome is sent to Home', async () => {
    profileStore.update({ onboarded: true });
    renderAt('/welcome');
    expect(await screen.findByRole('heading', { name: /good (morning|afternoon|evening)/i })).toBeTruthy();
  });

  it('Back keeps what was typed', async () => {
    const user = userEvent.setup();
    renderAt('/setup');
    await user.type(screen.getByLabelText(/what should we call you/i), 'Aryan');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText(/what should we call you/i) as HTMLInputElement).value).toBe('Aryan');
  });
});

describe('settings', () => {
  beforeEach(() => profileStore.update({ onboarded: true, name: 'Tanish' }));

  it('edits are saved immediately', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    await user.clear(name);
    await user.type(name, 'Preet');
    await user.click(screen.getByRole('checkbox', { name: /read my route advice aloud/i }));
    await user.click(screen.getByRole('radio', { name: /balanced/i }));
    expect(profileStore.get()).toMatchObject({ name: 'Preet', voiceOn: false, caution: 'balanced' });
  });

  it('Clear my data asks first, then returns to welcome', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    await user.click(screen.getByRole('button', { name: /clear my data/i }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(profileStore.get().onboarded).toBe(true); // nothing cleared yet
    await user.click(screen.getByRole('button', { name: /yes, clear everything/i }));
    expect(await screen.findByRole('heading', { name: /know before you go/i })).toBeTruthy();
    expect(profileStore.get()).toMatchObject({ onboarded: false, name: '' });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('Cancel keeps the data', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    await user.click(screen.getByRole('button', { name: /clear my data/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(profileStore.get().name).toBe('Tanish');
  });

  it('Hindi is disabled with an explanation when the device has no Hindi voice', async () => {
    hindi.available = false;
    renderAt('/settings');
    const hi = (await screen.findByRole('radio', { name: /hindi/i })) as HTMLInputElement;
    await waitFor(() => expect(hi.disabled).toBe(true));
    expect(screen.getByRole('note').textContent).toMatch(/no hindi voice/i);
  });

  it('Hindi is available, and Test voice speaks Hindi, when the device has a Hindi voice', async () => {
    hindi.available = true;
    const user = userEvent.setup();
    renderAt('/settings');
    const hi = (await screen.findByRole('radio', { name: /hindi/i })) as HTMLInputElement;
    await waitFor(() => expect(hi.disabled).toBe(false));
    expect(screen.queryByRole('note')).toBeNull();
    await user.click(hi);
    await user.click(screen.getByRole('button', { name: /test voice/i }));
    await waitFor(() => expect(spoken.calls).toHaveLength(1));
    expect(spoken.calls[0].lang).toBe('hi');
    expect(spoken.calls[0].text).toMatch(/[ऀ-ॿ]/);
  });

  it('Test voice speaks English by default, and falls back to English if Hindi was saved but is unavailable', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    await user.click(screen.getByRole('button', { name: /test voice/i }));
    await waitFor(() => expect(spoken.calls).toHaveLength(1));
    expect(spoken.calls[0]).toMatchObject({ lang: 'en' });

    cleanup();
    profileStore.update({ language: 'hi' });
    hindi.available = false;
    renderAt('/settings');
    await user.click(screen.getByRole('button', { name: /test voice/i }));
    await waitFor(() => expect(spoken.calls).toHaveLength(2));
    expect(spoken.calls[1].lang).toBe('en'); // never feed Devanagari to an English voice
  });

  it('says so when the voice could not play', async () => {
    spoken.ok = false;
    const user = userEvent.setup();
    renderAt('/settings');
    await user.click(screen.getByRole('button', { name: /test voice/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not play/i);
  });

  it('warns when the browser blocks storage (private window) and still works', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const user = userEvent.setup();
    renderAt('/settings');
    await user.type(screen.getByLabelText('Name'), 'X');
    expect(profileStore.get().name).toBe('TanishX');
    expect(screen.getByRole('status').textContent).toMatch(/blocking storage/i);
  });
});

describe('place field', () => {
  it('searches the full map only when asked, once per click', async () => {
    const { geocodePlace, searchPlaces } = await import('@/api/client');
    const user = userEvent.setup();
    renderAt('/setup');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByRole('combobox', { name: /home/i }), 'Some Odd Place');
    await waitFor(() => expect(searchPlaces).toHaveBeenCalled());
    expect(geocodePlace).not.toHaveBeenCalled(); // typing never calls the geocoder
    await user.click(screen.getByRole('button', { name: /search the full map for/i }));
    await waitFor(() => expect(geocodePlace).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/saved: 28\.4700, 77\.0400/i)).toBeTruthy();
  });

  it('shows an error instead of failing silently', async () => {
    const { geocodePlace, ApiError } = await import('@/api/client');
    vi.mocked(geocodePlace).mockRejectedValueOnce(new ApiError('http', 'Could not find that place.'));
    const user = userEvent.setup();
    renderAt('/setup');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByRole('combobox', { name: /work/i }), 'Nowhere');
    await user.click(screen.getByRole('button', { name: /search the full map for/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not find that place/i);
  });
});

describe('about', () => {
  it('states the test AUC, the flood-delay assumption and its derivation', async () => {
    renderAt('/about');
    expect(await screen.findByRole('heading', { name: /about routerain/i })).toBeTruthy();
    const page = document.body.textContent ?? '';
    expect(page).toMatch(/0\.638/);
    expect(page).toMatch(/23\.4 minutes/);
    expect(page).toMatch(/assumption, not measured data/i);
    expect(page).toMatch(/15 minor, 121 disrupted, 32 closed/);
    expect(page).toMatch(/a guide, not a guarantee/i);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBe('page');
  });
});
