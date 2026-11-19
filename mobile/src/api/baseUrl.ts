import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Where the backend lives. Comes from EXPO_PUBLIC_API_URL (baked in at bundle time) and can be
 * overridden at runtime from the developer field, so a new Cloudflare tunnel URL needs no rebuild.
 */
const STORAGE_KEY = 'routerain.apiUrlOverride.v1';
const FROM_ENV = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL ?? '');

let override: string | null = null;

/** Trim, drop trailing slashes, and accept only http(s) URLs. Returns '' for anything else. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/i.test(trimmed) ? trimmed : '';
}

export function getApiBaseUrl(): string {
  return override ?? FROM_ENV;
}

export function getEnvBaseUrl(): string {
  return FROM_ENV;
}

export function hasBaseUrlOverride(): boolean {
  return override !== null;
}

/** Call once at app start, before the first request. Never throws. */
export async function initApiBaseUrl(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    override = stored ? normalizeBaseUrl(stored) || null : null;
  } catch {
    override = null; // storage unavailable: fall back to the build-time URL
  }
}

/** Pass null (or an invalid URL) to go back to the build-time URL. Returns the URL now in use. */
export async function setApiBaseUrlOverride(raw: string | null): Promise<string> {
  const clean = raw ? normalizeBaseUrl(raw) : '';
  override = clean || null;
  try {
    if (override) await AsyncStorage.setItem(STORAGE_KEY, override);
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // the override still applies for this session
  }
  return getApiBaseUrl();
}
