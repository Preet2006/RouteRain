// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hindi = vi.hoisted(() => ({ available: false }));
const spoken = vi.hoisted(() => ({ calls: [] as { text: string; lang: string }[] }));

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {},
  searchPlaces: vi.fn().mockImplementation(async (q: string) => ({
    query: q,
    results: [
      { place_id: 'P021', name: 'Cyber Hub', category: 'landmark', lat: 28.4951, lon: 77.0891, verified: 0 },
      { place_id: 'P030', name: 'Medanta The Medicity', category: 'hospital', lat: 28.4395, lon: 77.0422, verified: 0 },
    ].filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())),
  })),
  geocodePlace: vi.fn().mockResolvedValue({ lat: 28.47, lon: 77.04, label: 'x' }),
  getScenarios: vi.fn().mockResolvedValue({ default_mode: 'live', scenarios: [] }),
}));
vi.mock('@/lib/speech', () => ({
  speech: {
    isSupported: () => true,
    hasHindi: async () => hindi.available,
    hasVoice: async () => true,
    loadVoices: async () => [],
    speak: async (text: string, lang: string) => {
      spoken.calls.push({ text, lang });
      return true;
    },
    stop: vi.fn(),
    isSpeaking: () => false,
  },
}));

import { Shell } from '@/components/Shell';
import { ScenarioProvider } from '@/lib/scenario';
import { STORAGE_KEY, profileStore } from '@/lib/storage';
import { Settings } from '@/pages/Settings';

function renderSettings() {
  const router = createMemoryRouter(
    [
      { path: '/settings', element: (<><Settings /><Link to="/other">go to other page</Link></>) },
      { path: '/other', element: <div>other page</div> },
      { path: '/', element: <div>entry page</div> },
    ],
    { initialEntries: ['/settings'] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}
const stored = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
const save = () => screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
const cancel = () => screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
const nameInput = () => screen.getByLabelText('Name') as HTMLInputElement;

beforeEach(() => {
  window.localStorage.clear();
  profileStore.reload();
  profileStore.update({
    onboarded: true, name: 'Tanish', voiceOn: true, language: 'en', caution: 'cautious',
    home: { label: 'Sector 29', lat: 28.467, lon: 77.065 }, work: { label: 'Cyber Hub', lat: 28.4951, lon: 77.0891 },
  });
  hindi.available = false;
  spoken.calls.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('draft and Save', () => {
  it('starts with the saved values and nothing to save', () => {
    renderSettings();
    expect(nameInput().value).toBe('Tanish');
    expect((screen.getByRole('combobox', { name: 'Home' }) as HTMLInputElement).value).toBe('Sector 29');
    expect(save().disabled).toBe(true);
    expect(cancel().disabled).toBe(true);
    expect(screen.getByText('No unsaved changes.')).toBeTruthy();
  });

  it('editing changes only the draft: nothing is stored and the greeting does not change until Save', async () => {
    const before = window.localStorage.getItem(STORAGE_KEY);
    const user = userEvent.setup();
    renderSettings();
    await user.clear(nameInput());
    await user.type(nameInput(), 'Preet');
    await user.click(screen.getByRole('checkbox', { name: /read my route advice aloud/i }));
    await user.click(screen.getByRole('radio', { name: /balanced/i }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(profileStore.get()).toMatchObject({ name: 'Tanish', voiceOn: true, caution: 'cautious' });
    expect(save().disabled).toBe(false);
    expect(screen.getByText('You have unsaved changes.')).toBeTruthy();
  });

  it('Save writes everything to storage, shows "Settings saved", and disables Save again', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.clear(nameInput());
    await user.type(nameInput(), '  Preet  ');
    await user.click(screen.getByRole('checkbox', { name: /read my route advice aloud/i }));
    await user.click(screen.getByRole('radio', { name: /balanced/i }));
    await user.click(save());
    expect(stored()).toMatchObject({ name: 'Preet', voiceOn: false, caution: 'balanced', onboarded: true });
    expect(profileStore.get()).toMatchObject({ name: 'Preet', voiceOn: false, caution: 'balanced' });
    expect((await screen.findByText('Settings saved')).closest('[role=status]')).toBeTruthy();
    expect(save().disabled).toBe(true);
    expect(screen.getByText('No unsaved changes.')).toBeTruthy();
  });

  it('the toast goes away by itself', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderSettings();
    fireEvent.change(nameInput(), { target: { value: 'Aryan' } });
    fireEvent.click(save());
    expect(screen.getByText('Settings saved')).toBeTruthy();
    await act(async () => void vi.advanceTimersByTime(4000));
    expect(screen.queryByText('Settings saved')).toBeNull();
    vi.useRealTimers();
  });

  it('Cancel puts every saved value back and stores nothing', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.clear(nameInput());
    await user.type(nameInput(), 'Someone else');
    await user.click(screen.getByRole('radio', { name: /balanced/i }));
    await user.click(screen.getByRole('button', { name: 'Clear Home' }));
    await user.click(cancel());
    expect(nameInput().value).toBe('Tanish');
    expect((screen.getByRole('radio', { name: /cautious/i }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Home' }) as HTMLInputElement).value).toBe('Sector 29');
    expect(save().disabled).toBe(true);
    expect(profileStore.get()).toMatchObject({ name: 'Tanish', caution: 'cautious' });
  });

  it('saves a cleared place as cleared', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Clear Home' }));
    await user.click(save());
    expect(stored().home).toBeNull();
    expect(stored().work).toMatchObject({ label: 'Cyber Hub' });
  });

  it('saves a newly chosen place', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Clear Work' }));
    await user.type(screen.getByRole('combobox', { name: 'Work' }), 'medanta');
    await user.click(await screen.findByRole('option', { name: /medanta/i }));
    await user.click(save());
    expect(stored().work).toEqual({ label: 'Medanta The Medicity', lat: 28.4395, lon: 77.0422 });
  });

  it('puts a value back by hand and the change disappears again', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.type(nameInput(), 'X');
    expect(save().disabled).toBe(false);
    await user.type(nameInput(), '{Backspace}');
    expect(save().disabled).toBe(true);
  });

  it('applies at once: the greeting in the top bar changes after Save', async () => {
    const router = createMemoryRouter(
      [{ element: <ScenarioProvider><Shell /></ScenarioProvider>, children: [{ path: '/settings', element: <Settings /> }] }],
      { initialEntries: ['/settings'] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    expect(screen.getByRole('banner').textContent).toMatch(/Tanish/);
    fireEvent.change(nameInput(), { target: { value: 'Laksh' } });
    expect(screen.getByRole('banner').textContent).toMatch(/Tanish/); // not yet
    fireEvent.click(save());
    expect(screen.getByRole('banner').textContent).toMatch(/Good (morning|afternoon|evening), Laksh/);
  });

  it('says so when the browser blocks storage, and still keeps the settings for the session', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    renderSettings();
    fireEvent.change(nameInput(), { target: { value: 'Preet' } });
    fireEvent.click(save());
    expect((await screen.findByText(/saved for this session only/i)).textContent).toMatch(/blocking storage/i);
    expect(profileStore.get().name).toBe('Preet');
  });
});

describe('validation', () => {
  it('the name field stops at 40 characters, and a longer value cannot be saved', async () => {
    renderSettings();
    expect(nameInput().maxLength).toBe(40);
    fireEvent.change(nameInput(), { target: { value: 'a'.repeat(45) } });
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toMatch(/at most 40 characters/);
    expect(nameInput().getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Fix the highlighted fields to save.')).toBeTruthy();
    expect(profileStore.get().name).toBe('Tanish'); // nothing was stored
  });

  it('place text that was typed but not chosen blocks saving, with advice', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.clear(screen.getByRole('combobox', { name: 'Home' }));
    await user.type(screen.getByRole('combobox', { name: 'Home' }), 'Some unknown corner');
    expect(save().disabled).toBe(false); // there is something to lose, so the bar is live
    await user.click(save());
    expect((await screen.findAllByRole('alert')).map((a) => a.textContent).join(' ')).toMatch(/choose a place from the suggestions/i);
    expect(profileStore.get().home).toMatchObject({ label: 'Sector 29' });
  });

  it('choosing a place from the suggestions clears the problem and allows saving', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.clear(screen.getByRole('combobox', { name: 'Home' }));
    await user.type(screen.getByRole('combobox', { name: 'Home' }), 'cyber');
    await user.click(save());
    expect(await screen.findByText('Fix the highlighted fields to save.')).toBeTruthy();
    await user.click(await screen.findByRole('option', { name: /cyber hub/i }));
    await user.click(save());
    expect(stored().home).toMatchObject({ label: 'Cyber Hub' });
    expect(await screen.findByText('Settings saved')).toBeTruthy();
  });
});

describe('leaving with unsaved changes', () => {
  it('shows an in-app "Discard unsaved changes?" dialog, not a browser alert, and stays on the page', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    const user = userEvent.setup();
    const router = renderSettings();
    await user.type(nameInput(), 'X');
    await user.click(screen.getByRole('link', { name: 'go to other page' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(dialog.textContent).toMatch(/will be lost/i);
    expect(router.state.location.pathname).toBe('/settings');
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Keep editing' }));
  });

  it('Keep editing stays, with the draft intact', async () => {
    const user = userEvent.setup();
    const router = renderSettings();
    await user.type(nameInput(), 'X');
    await user.click(screen.getByRole('link', { name: 'go to other page' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/settings');
    expect(nameInput().value).toBe('TanishX');
  });

  it('Escape also keeps editing', async () => {
    const user = userEvent.setup();
    const router = renderSettings();
    await user.type(nameInput(), 'X');
    await user.click(screen.getByRole('link', { name: 'go to other page' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('Discard changes leaves, and the changes were never saved', async () => {
    const user = userEvent.setup();
    const router = renderSettings();
    await user.type(nameInput(), 'X');
    await user.click(screen.getByRole('link', { name: 'go to other page' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
    expect(profileStore.get().name).toBe('Tanish');
  });

  it('Back / programmatic navigation is guarded too', async () => {
    const user = userEvent.setup();
    const router = renderSettings();
    await user.type(nameInput(), 'X');
    await act(async () => void router.navigate('/other'));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('keeps focus inside the dialog when Tab is pressed', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.type(nameInput(), 'X');
    await user.click(screen.getByRole('link', { name: 'go to other page' }));
    const dialog = await screen.findByRole('alertdialog');
    const keep = within(dialog).getByRole('button', { name: 'Keep editing' });
    const discard = within(dialog).getByRole('button', { name: 'Discard changes' });
    expect(document.activeElement).toBe(keep);
    await user.tab();
    expect(document.activeElement).toBe(discard);
    await user.tab();
    expect(document.activeElement).toBe(keep);
  });

  it('no prompt when nothing changed', async () => {
    const user = userEvent.setup();
    const router = renderSettings();
    await user.click(screen.getByRole('link', { name: 'go to other page' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('no prompt after Save, and none after Cancel', async () => {
    const user = userEvent.setup();
    let router = renderSettings();
    await user.type(nameInput(), 'X');
    await user.click(save());
    await user.click(screen.getByRole('link', { name: 'go to other page' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
    cleanup();
    router = renderSettings();
    await user.type(nameInput(), 'Y');
    await user.click(cancel());
    await user.click(screen.getByRole('link', { name: 'go to other page' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
  });

  it('the browser tab-close prompt is armed only while there are unsaved changes', async () => {
    const user = userEvent.setup();
    renderSettings();
    const fire = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(fire()).toBe(false);
    await user.type(nameInput(), 'X');
    expect(fire()).toBe(true);
    await user.click(save());
    expect(fire()).toBe(false);
  });
});

describe('Clear my data', () => {
  it('is separate from Save, asks first, and Cancel keeps everything', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('button', { name: /clear my data/i }));
    expect(screen.getByRole('alertdialog', { name: /confirm clearing your data/i })).toBeTruthy();
    expect(profileStore.get().onboarded).toBe(true);
    await user.click(within(screen.getByRole('alertdialog', { name: /confirm clearing/i })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(profileStore.get().name).toBe('Tanish');
  });

  it('wipes storage and returns to the entry screen, with no second "discard" prompt even if edits were unsaved', async () => {
    const user = userEvent.setup();
    const router = renderSettings();
    await user.type(nameInput(), 'X');
    await user.click(screen.getByRole('button', { name: /clear my data/i }));
    await user.click(screen.getByRole('button', { name: /yes, clear everything/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(profileStore.get()).toMatchObject({ onboarded: false, name: '' });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('preferences inside the draft', () => {
  it('Hindi is disabled with an explanation when the device has no Hindi voice', async () => {
    renderSettings();
    const hi = (await screen.findByRole('radio', { name: /hindi/i })) as HTMLInputElement;
    await waitFor(() => expect(hi.disabled).toBe(true));
    expect(screen.getByRole('note').textContent).toMatch(/no hindi voice/i);
  });

  it('Test voice speaks the DRAFT language without saving anything', async () => {
    hindi.available = true;
    const user = userEvent.setup();
    renderSettings();
    const hi = (await screen.findByRole('radio', { name: /hindi/i })) as HTMLInputElement;
    await waitFor(() => expect(hi.disabled).toBe(false));
    await user.click(hi);
    await user.click(screen.getByRole('button', { name: /test voice/i }));
    await waitFor(() => expect(spoken.calls).toHaveLength(1));
    expect(spoken.calls[0].lang).toBe('hi');
    expect(profileStore.get().language).toBe('en'); // still unsaved
    await user.click(save());
    expect(stored().language).toBe('hi');
  });

  it('a saved Hindi choice on a device with no Hindi voice is spoken in English', async () => {
    profileStore.update({ language: 'hi' });
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('button', { name: /test voice/i }));
    await waitFor(() => expect(spoken.calls).toHaveLength(1));
    expect(spoken.calls[0].lang).toBe('en');
  });
});
