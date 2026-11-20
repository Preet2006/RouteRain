import type { z } from 'zod';

import {
  ErrorBodySchema,
  GeocodeSchema,
  HealthSchema,
  HotspotsResponseSchema,
  NarrateResponseSchema,
  PlacesSearchSchema,
  RouteResponseSchema,
  ScenariosSchema,
} from './schemas';

/** Same origin in production (FastAPI serves the site); Vite proxies /api in development. */
const API = '/api/v2';
const DEFAULT_TIMEOUT_MS = 20_000;

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'schema';

/** Every failure is an ApiError whose message is safe to show on screen (never a blank map). */
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

type Init = { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number; signal?: AbortSignal };

export async function request<S extends z.ZodType>(path: string, schema: S, init: Init = {}): Promise<z.infer<S>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  init.signal?.addEventListener('abort', () => controller.abort());

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch {
    if (timedOut) throw new ApiError('timeout', 'The RouteRain server took too long to answer.');
    throw new ApiError('network', "Can't reach the RouteRain server.");
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
  if (!result.success) throw new ApiError('schema', 'The server reply was not in the expected format.');
  return result.data;
}

export type Caution = 'cautious' | 'balanced';
export type Mode = 'live' | 'replay';
export type LatLonLabel = { lat: number; lon: number; label?: string };

export const getHealth = () => request('/health', HealthSchema, { timeoutMs: 8_000 });
export const getScenarios = () => request('/scenarios', ScenariosSchema);

/** Live can take ~30 s the first time (it fetches 12 forecasts); replay's first call can take ~20 s. */
export const getHotspots = (mode: Mode, date?: string | null) =>
  request(
    `/hotspots?mode=${mode}${mode === 'replay' && date ? `&date=${encodeURIComponent(date)}` : ''}`,
    HotspotsResponseSchema,
    { timeoutMs: 90_000 },
  );

export const searchPlaces = (q: string, signal?: AbortSignal) =>
  request(`/places/search?q=${encodeURIComponent(q)}`, PlacesSearchSchema, { signal, timeoutMs: 8_000 });
export const geocodePlace = (q: string) => request('/places/geocode', GeocodeSchema, { method: 'POST', body: { q } });

export const createRoute = (body: {
  origin: LatLonLabel;
  destination: LatLonLabel;
  caution: Caution;
  mode: Mode;
  date?: string | null;
}) => request('/route', RouteResponseSchema, { method: 'POST', body, timeoutMs: 90_000 });
export const getRoute = (routeId: string) => request(`/route/${encodeURIComponent(routeId)}`, RouteResponseSchema);
export const narrate = (body: { route_id: string; user_name?: string | null; language: 'en' | 'hi' }) =>
  request('/narrate', NarrateResponseSchema, { method: 'POST', body, timeoutMs: 15_000 });
