/**
 * zod schemas mirroring the backend contract (MOBILE_APP_PLAN.md section 4).
 *
 * Section 1 is served today and is checked against the real backend by
 * `npm run check:contract`. Section 2 is a DRAFT of endpoints that do not exist yet
 * (/hotspots, /route, /narrate): field names follow section 4 but WILL be finalised when
 * those endpoints are built, so do not rely on them yet.
 *
 * This file has no imports except zod so it can also run under plain Node.
 */
import { z } from 'zod';

// ---- 1. Served today ------------------------------------------------------------------

export const HealthSchema = z.object({
  ok: z.boolean(),
  model_loaded: z.boolean(),
  graph_loaded: z.boolean(),
  llm_available: z.boolean(),
  model_file_present: z.boolean(),
  places: z.object({ count: z.number().int(), verified: z.number().int() }),
  api_version: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

export const PlaceSchema = z.object({
  place_id: z.string(),
  name: z.string(),
  category: z.string(),
  lat: z.number(),
  lon: z.number(),
  verified: z.number().int(), // 0 = not yet checked on a map by the team
});
export type Place = z.infer<typeof PlaceSchema>;

export const PlacesSearchSchema = z.object({
  query: z.string(),
  results: z.array(PlaceSchema).max(8),
});

export const GeocodeSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  label: z.string(),
});
export type GeocodeResult = z.infer<typeof GeocodeSchema>;

export const ScenariosSchema = z.object({
  default_mode: z.enum(['live', 'replay']),
  scenarios: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string() })),
});
export type Scenarios = z.infer<typeof ScenariosSchema>;

/** FastAPI error body, e.g. {"detail": "No drivable route found between these points."} */
export const ErrorBodySchema = z.object({ detail: z.union([z.string(), z.array(z.unknown())]) });

// ---- 2. DRAFT: not served yet ---------------------------------------------------------

export const TierSchema = z.enum(['GREEN', 'YELLOW', 'RED', 'NOT_SCORED']);

export const ScenarioMetaSchema = z.object({
  mode: z.enum(['live', 'replay']),
  date: z.string().nullable(),
  forecast_generated_at: z.string().nullable(),
});

export const HotspotSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  tier: TierSchema,
  probability: z.number().min(0).max(1).nullable(), // null when NOT_SCORED: never invented
  explanation: z.string(),
  reported_flooded: z.boolean().nullable().optional(), // replay only, shown separately from the prediction
});
export const HotspotsResponseSchema = z.object({ scenario: ScenarioMetaSchema, hotspots: z.array(HotspotSchema) });

const LatLonSchema = z.tuple([z.number(), z.number()]);
const RouteLegSchema = z.object({
  polyline: z.array(LatLonSchema).max(300),
  drive_time_min: z.number(),
  distance_km: z.number(),
  near_hotspots: z.array(HotspotSchema.pick({ id: true, name: true, tier: true, probability: true })),
  expected_time_min: z.number(),
});
export const RouteResponseSchema = z.object({
  scenario: ScenarioMetaSchema,
  route_id: z.string(),
  normal_route: RouteLegSchema,
  flood_aware_route: RouteLegSchema,
  expected_saving_min: z.number(),
  added_drive_min: z.number(),
  avoided_hotspots: z.array(z.object({ id: z.string(), name: z.string(), tier: TierSchema })),
  template_advice: z.string(),
});

export const NarrateResponseSchema = z.object({ text: z.string(), source: z.enum(['llm', 'template']) });
