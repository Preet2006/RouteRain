/**
 * Personalisation profile (name, saved places, preferences). Lives in the browser's localStorage only,
 * never on the server. Every access is wrapped in try/catch: private windows, blocked site data or a full
 * quota make localStorage throw, in which case the profile lives in memory for the session.
 */
import { z } from 'zod';

export const PROFILE_VERSION = 1;
export const STORAGE_KEY = 'routerain.profile';
export const MAX_RECENT_TRIPS = 5;
export const MAX_NAME_LENGTH = 40;

const SavedPlaceSchema = z.object({
  label: z.string().min(1).max(120),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type SavedPlace = z.infer<typeof SavedPlaceSchema>;

const RecentTripSchema = z.object({ origin: SavedPlaceSchema, destination: SavedPlaceSchema, at: z.number() });
export type RecentTrip = z.infer<typeof RecentTripSchema>;

const ProfileSchema = z.object({
  version: z.literal(PROFILE_VERSION),
  name: z.string().max(MAX_NAME_LENGTH),
  home: SavedPlaceSchema.nullable(),
  work: SavedPlaceSchema.nullable(),
  voiceOn: z.boolean(),
  language: z.enum(['en', 'hi']),
  caution: z.enum(['cautious', 'balanced']),
  recentTrips: z.array(RecentTripSchema).max(MAX_RECENT_TRIPS),
  onboarded: z.boolean(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const DEFAULT_PROFILE: Profile = {
  version: PROFILE_VERSION,
  name: '',
  home: null,
  work: null,
  voiceOn: true,
  language: 'en',
  caution: 'cautious',
  recentTrips: [],
  onboarded: false,
};

/** The subset of the Web Storage API we use, so tests can inject a fake. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Turns whatever was stored into a valid Profile. Unknown or corrupt data falls back to defaults; a
 * partly valid object keeps the valid fields. Version changes would be migrated here.
 */
export function parseProfile(raw: unknown): Profile {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PROFILE };
  const input = raw as Record<string, unknown>;
  const whole = ProfileSchema.safeParse({ ...DEFAULT_PROFILE, ...input, version: PROFILE_VERSION });
  if (whole.success) return whole.data;
  // Field by field: keep what is valid, default the rest.
  const out: Record<string, unknown> = { ...DEFAULT_PROFILE };
  for (const key of Object.keys(DEFAULT_PROFILE) as (keyof Profile)[]) {
    const candidate = { ...DEFAULT_PROFILE, [key]: input[key] ?? DEFAULT_PROFILE[key], version: PROFILE_VERSION };
    if (ProfileSchema.safeParse(candidate).success) out[key] = candidate[key];
  }
  return out as Profile;
}

export function createProfileStore(getStorage: () => KeyValueStorage | null) {
  let profile: Profile = { ...DEFAULT_PROFILE };
  let persistent = false;
  const listeners = new Set<() => void>();

  function storage(): KeyValueStorage | null {
    try {
      return getStorage();
    } catch {
      return null; // even touching window.localStorage can throw
    }
  }

  function load() {
    try {
      const s = storage();
      const text = s?.getItem(STORAGE_KEY);
      persistent = s !== null;
      profile = text ? parseProfile(JSON.parse(text)) : { ...DEFAULT_PROFILE };
    } catch {
      profile = { ...DEFAULT_PROFILE };
      persistent = false;
    }
  }

  function persist() {
    try {
      storage()?.setItem(STORAGE_KEY, JSON.stringify(profile));
      persistent = storage() !== null;
    } catch {
      persistent = false; // quota or blocked: keep working in memory
    }
  }

  load();

  return {
    get: () => profile,
    /** False when the profile only lives in memory (storage blocked): the UI can say "not saved". */
    isPersistent: () => persistent,
    update(patch: Partial<Omit<Profile, 'version'>>) {
      profile = parseProfile({ ...profile, ...patch });
      persist();
      listeners.forEach((l) => l());
    },
    addRecentTrip(origin: SavedPlace, destination: SavedPlace) {
      const same = (a: SavedPlace, b: SavedPlace) => a.lat === b.lat && a.lon === b.lon;
      const rest = profile.recentTrips.filter((t) => !(same(t.origin, origin) && same(t.destination, destination)));
      this.update({ recentTrips: [{ origin, destination, at: Date.now() }, ...rest].slice(0, MAX_RECENT_TRIPS) });
    },
    /** "Clear my data": back to defaults, so onboarding shows again. */
    clear() {
      profile = { ...DEFAULT_PROFILE };
      try {
        storage()?.removeItem(STORAGE_KEY);
      } catch {
        /* nothing to remove */
      }
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Re-read storage (used after another tab changes it). */
    reload() {
      load();
      listeners.forEach((l) => l());
    },
  };
}

export const profileStore = createProfileStore(() => (typeof window === 'undefined' ? null : window.localStorage));

/** "Good morning/afternoon/evening, Name" (or without the name). */
export function greeting(name: string, now: Date = new Date()): string {
  const h = now.getHours();
  const part = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const trimmed = name.trim();
  return trimmed ? `${part}, ${trimmed}` : part;
}
