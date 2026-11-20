import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROFILE, MAX_RECENT_TRIPS, STORAGE_KEY, createProfileStore, greeting, parseProfile,
  type KeyValueStorage,
} from './storage';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

const place = (n: number) => ({ label: `Place ${n}`, lat: 28 + n / 100, lon: 77 + n / 100 });

describe('profile store', () => {
  it('starts from defaults with onboarding not done', () => {
    const store = createProfileStore(() => memoryStorage());
    expect(store.get()).toEqual(DEFAULT_PROFILE);
    expect(store.get().onboarded).toBe(false);
  });

  it('persists updates and reloads them', () => {
    const s = memoryStorage();
    const store = createProfileStore(() => s);
    store.update({ name: 'Tanish', onboarded: true, language: 'hi', caution: 'balanced', home: place(1) });
    expect(JSON.parse(s.data[STORAGE_KEY]).name).toBe('Tanish');
    const again = createProfileStore(() => s);
    expect(again.get()).toMatchObject({ name: 'Tanish', onboarded: true, language: 'hi', caution: 'balanced', home: place(1) });
  });

  it('clear() returns to defaults so onboarding shows again', () => {
    const s = memoryStorage();
    const store = createProfileStore(() => s);
    store.update({ name: 'Tanish', onboarded: true });
    store.clear();
    expect(store.get().onboarded).toBe(false);
    expect(s.data[STORAGE_KEY]).toBeUndefined();
  });

  it('keeps at most 5 recent trips, newest first, without duplicates', () => {
    const store = createProfileStore(() => memoryStorage());
    for (let i = 1; i <= 7; i++) store.addRecentTrip(place(i), place(i + 10));
    store.addRecentTrip(place(5), place(15)); // repeat of an existing trip moves it to the front
    const trips = store.get().recentTrips;
    expect(trips).toHaveLength(MAX_RECENT_TRIPS);
    expect(trips[0].origin).toEqual(place(5));
    expect(trips.filter((t) => t.origin.label === 'Place 5')).toHaveLength(1);
  });

  it('falls back to memory when storage throws on access', () => {
    const store = createProfileStore(() => {
      throw new Error('SecurityError');
    });
    expect(store.isPersistent()).toBe(false);
    store.update({ name: 'Aryan' });
    expect(store.get().name).toBe('Aryan'); // still works for the session
  });

  it('falls back to memory when writes throw (quota / blocked)', () => {
    const s = memoryStorage();
    s.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const store = createProfileStore(() => s);
    store.update({ name: 'Preet' });
    expect(store.get().name).toBe('Preet');
    expect(store.isPersistent()).toBe(false);
  });

  it('survives corrupt stored data', () => {
    expect(createProfileStore(() => memoryStorage({ [STORAGE_KEY]: '{not json' })).get()).toEqual(DEFAULT_PROFILE);
    expect(createProfileStore(() => memoryStorage({ [STORAGE_KEY]: 'null' })).get()).toEqual(DEFAULT_PROFILE);
  });

  it('keeps valid fields and defaults invalid ones', () => {
    const p = parseProfile({ name: 'Laksh', language: 'fr', caution: 'balanced', recentTrips: 'x', voiceOn: false });
    expect(p).toMatchObject({ name: 'Laksh', language: 'en', caution: 'balanced', voiceOn: false, recentTrips: [] });
  });

  it('rejects out-of-range coordinates and over-long names', () => {
    const p = parseProfile({ name: 'x'.repeat(200), home: { label: 'Far', lat: 123, lon: 0 } });
    expect(p.name).toBe('');
    expect(p.home).toBeNull();
  });

  it('notifies subscribers on change', () => {
    const store = createProfileStore(() => memoryStorage());
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.update({ name: 'A' });
    store.clear();
    off();
    store.update({ name: 'B' });
    expect(calls).toBe(2);
  });
});

describe('greeting', () => {
  it('uses the time of day and the name', () => {
    const at = (h: number) => new Date(2026, 7, 7, h, 0, 0);
    expect(greeting('Tanish', at(8))).toBe('Good morning, Tanish');
    expect(greeting('Tanish', at(14))).toBe('Good afternoon, Tanish');
    expect(greeting('Tanish', at(19))).toBe('Good evening, Tanish');
    expect(greeting('  ', at(8))).toBe('Good morning');
  });
});
