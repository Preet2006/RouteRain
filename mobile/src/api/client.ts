import type { z } from 'zod';

import { getApiBaseUrl } from './baseUrl';
import {
  ErrorBodySchema,
  GeocodeSchema,
  HealthSchema,
  PlacesSearchSchema,
  ScenariosSchema,
} from './schemas';

const API_PREFIX = '/mobile/v1';
const TIMEOUT_MS = 10_000;

export type ApiErrorKind = 'no-url' | 'network' | 'timeout' | 'http' | 'schema';

/**
 * Every failure becomes an ApiError with a message that is safe to show on screen
 * ("fail loudly": the app never shows a blank map or an empty result instead of an error).
 */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<z.infer<S>> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new ApiError('no-url', 'No server address is set. Add EXPO_PUBLIC_API_URL or use the developer field.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${base}${API_PREFIX}${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError('timeout', "RouteRain server took too long to answer.");
    }
    throw new ApiError('network', "Can't reach RouteRain server.");
  } finally {
    clearTimeout(timer);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('http', `Unexpected reply from the server (HTTP ${response.status}).`, response.status);
  }

  if (!response.ok) {
    const parsed = ErrorBodySchema.safeParse(payload);
    const detail = parsed.success && typeof parsed.data.detail === 'string' ? parsed.data.detail : null;
    throw new ApiError('http', detail ?? `The server returned an error (HTTP ${response.status}).`, response.status);
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiError('schema', 'The server reply was not in the expected format. Is the app up to date?');
  }
  return result.data;
}

export const getHealth = () => request('/health', HealthSchema);

export const getScenarios = () => request('/scenarios', ScenariosSchema);

export const searchPlaces = (q: string) =>
  request(`/places/search?q=${encodeURIComponent(q)}`, PlacesSearchSchema);

export const geocodePlace = (q: string) =>
  request('/places/geocode', GeocodeSchema, { method: 'POST', body: { q } });
