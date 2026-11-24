/**
 * zod schemas for the /api/v2 backend (WEB_APP_PLAN.md section 6). They mirror what the server really
 * returns and are checked against the running backend by `npm run check:contract`.
 * No imports except zod, so the contract script can load this file under plain Node.
 */
import { z } from 'zod';

export const TierSchema = z.enum(['RED', 'YELLOW', 'GREEN', 'LOW_RAIN']);

export const ScenarioMetaSchema = z.object({
  mode: z.enum(['live', 'replay']),
  date: z.string().nullable(),
  forecast_generated_at: z.string().nullable(),
});
export type ScenarioMeta = z.infer<typeof ScenarioMetaSchema>;

export const HealthSchema = z.object({
  ok: z.boolean(),
  model_loaded: z.boolean(),
  graph_loaded: z.boolean(),
  llm_available: z.boolean(),
  model_file_present: z.boolean(),
  places: z.object({ count: z.number().int(), verified: z.number().int() }),
  flood_delay_min: z.number(),
  api_version: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

export const ScenariosSchema = z.object({
  default_mode: z.enum(['live', 'replay']),
  scenarios: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string() })),
});

export const HotspotSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  tier: TierSchema,
  probability: z.number().min(0).max(1).nullable(), // null for LOW_RAIN: never invented
  explanation: z.string(),
  reported_outcome: z.enum(['flooded', 'no_report']).nullable(), // replay only; separate from the prediction
  type: z.string(), // what kind of place it is, e.g. "chowk/underpass"
});
export type Hotspot = z.infer<typeof HotspotSchema>;

export const HotspotsResponseSchema = z.object({
  scenario: ScenarioMetaSchema,
  tiers: z.object({ RED: z.number(), YELLOW: z.number(), GREEN: z.number(), LOW_RAIN: z.number() }),
  hotspots: z.array(HotspotSchema),
});
export type HotspotsResponse = z.infer<typeof HotspotsResponseSchema>;

export const HotspotDetailSchema = z.object({
  scenario: ScenarioMetaSchema,
  hotspot: HotspotSchema,
  buffer_m: z.number(),
  terrain: z.object({ elevation_m: z.number(), sink_depth_m: z.number(), slope_deg: z.number(), catchment_cells: z.number() }),
  // The rain and soil conditions the model saw on that day. null when the hotspot was not scored (LOW RAIN).
  conditions: z
    .object({
      rain_24h: z.number().nullable(),
      rain_max_1h: z.number().nullable(),
      rain_max_3h: z.number().nullable(),
      rain_prev_3d: z.number().nullable(),
      soil_moisture_surface: z.number().nullable(),
      rain_season_cumulative: z.number().nullable(),
    })
    .nullable(),
  history: z.object({ recorded_floods: z.number().int(), first_date: z.string().nullable(), last_date: z.string().nullable() }),
  infrastructure: z.object({
    flagged: z.boolean(),
    note: z.string().nullable(),
    evidence_date: z.string().nullable(),
    source_url: z.string().nullable(),
  }),
});
export type HotspotDetail = z.infer<typeof HotspotDetailSchema>;

export const PlaceSchema = z.object({
  place_id: z.string(),
  name: z.string(),
  category: z.string(),
  lat: z.number(),
  lon: z.number(),
  verified: z.number().int(), // 0 = not yet checked on a map by the team
});
export type Place = z.infer<typeof PlaceSchema>;

export const PlacesSearchSchema = z.object({ query: z.string(), results: z.array(PlaceSchema).max(8) });

export const GeocodeSchema = z.object({ lat: z.number(), lon: z.number(), label: z.string() });
export type GeocodeResult = z.infer<typeof GeocodeSchema>;

// ---- route ----
const LatLonSchema = z.tuple([z.number(), z.number()]);
const NearHotspotSchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: TierSchema,
  probability: z.number().nullable(),
});
const RouteLegSchema = z.object({
  polyline: z.array(LatLonSchema).max(300),
  drive_time_min: z.number(),
  distance_km: z.number(),
  near_hotspots: z.array(NearHotspotSchema),
  expected_time_min: z.number(),
});
const AvoidedSchema = NearHotspotSchema.extend({ explanation: z.string() });
const PointSchema = z.object({ lat: z.number(), lon: z.number(), label: z.string() });

export const RouteResponseSchema = z.object({
  route_id: z.string(),
  scenario: ScenarioMetaSchema,
  origin: PointSchema,
  destination: PointSchema,
  caution: z.enum(['cautious', 'balanced']),
  normal_route: RouteLegSchema,
  flood_aware_route: RouteLegSchema,
  identical_routes: z.boolean(),
  expected_saving_min: z.number(),
  added_drive_min: z.number(),
  flood_delay_min: z.number(),
  avoided_hotspots: z.array(AvoidedSchema),
  still_passes_through: z.array(AvoidedSchema),
  risk_zones: z.array(
    z.object({ id: z.string(), name: z.string(), lat: z.number(), lon: z.number(), tier: TierSchema, radius_m: z.number() }),
  ),
  template_advice: z.string(),
});
export type RouteResponse = z.infer<typeof RouteResponseSchema>;

export const NarrateResponseSchema = z.object({
  text: z.string(),
  source: z.enum(['llm', 'template']),
  language: z.enum(['en', 'hi']),
  scenario: ScenarioMetaSchema,
});
export type NarrateResponse = z.infer<typeof NarrateResponseSchema>;

/** FastAPI error body, e.g. {"detail": "No drivable route found between these points."} */
export const ErrorBodySchema = z.object({ detail: z.union([z.string(), z.array(z.unknown())]) });

/** GET /route/{id}/directions (phase U4): turn-by-turn steps, the full navigation line and hotspot events. */
export const NavStepSchema = z.object({
  index: z.number(),
  maneuver: z.enum(['depart', 'continue', 'turn', 'slight', 'sharp', 'uturn', 'roundabout', 'arrive']),
  modifier: z.enum(['left', 'right', 'straight']).nullable(),
  street: z.string().nullable(),
  distance_m: z.number(),
  duration_s: z.number(),
  location: z.tuple([z.number(), z.number()]),
  bearing_before: z.number().nullable(),
  bearing_after: z.number().nullable(),
  exit_number: z.number().nullable(),
  instruction_en: z.string(),
  path_index: z.number(),
  start_m: z.number(),
});
export type NavStep = z.infer<typeof NavStepSchema>;

export const HotspotEventSchema = z.object({
  hotspot_id: z.string(),
  name: z.string(),
  tier: TierSchema,
  buffer_m: z.number().nullable(),
  approach_distance_m: z.number(),
  closest_distance_along_m: z.number(),
  closest_distance_m: z.number(),
  exit_distance_m: z.number(),
  side: z.enum(['left', 'right', 'on_route']),
  within_radius: z.boolean(),
  passes_through: z.boolean(),
  avoided: z.boolean(),
});
export type HotspotEvent = z.infer<typeof HotspotEventSchema>;

export const DirectionsSchema = z.object({
  route_id: z.string(),
  which: z.enum(['flood_aware', 'normal']),
  language: z.string(),
  total_distance_m: z.number(),
  total_duration_s: z.number(),
  steps: z.array(NavStepSchema).min(1),
  geometry: z.object({
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(1),
    cumulative_m: z.array(z.number()).min(1),
    step_point_index: z.array(z.number()),
  }),
  hotspot_events: z.array(HotspotEventSchema),
});
export type Directions = z.infer<typeof DirectionsSchema>;
