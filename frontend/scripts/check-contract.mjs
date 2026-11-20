// Checks the REAL backend's JSON against the website's zod schemas (src/api/schemas.ts).
// Usage:  npm run check:contract -- http://127.0.0.1:8000
// Needs the backend running. Replay checks use a date from /scenarios; no live forecast call is made.
import {
  GeocodeSchema, HealthSchema, HotspotsResponseSchema, NarrateResponseSchema, PlacesSearchSchema,
  RouteResponseSchema, ScenariosSchema,
} from '../src/api/schemas.ts';

const base = (process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
const api = `${base}/api/v2`;
let failed = 0;

async function call(name, method, path, schema, body) {
  try {
    const res = await fetch(api + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    const parsed = schema.safeParse(json);
    if (res.ok && parsed.success) console.log(`PASS  ${name}`);
    else {
      failed++;
      console.log(`FAIL  ${name}  HTTP ${res.status}`);
      console.log(parsed.success ? json : JSON.stringify(parsed.error.issues, null, 2));
    }
    return res.ok && parsed.success ? parsed.data : null;
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}  ${error.message}`);
    return null;
  }
}

await call('GET /health', 'GET', '/health', HealthSchema);
const scenarios = await call('GET /scenarios', 'GET', '/scenarios', ScenariosSchema);
await call('GET /places/search?q=cyber', 'GET', '/places/search?q=cyber', PlacesSearchSchema);
if (process.argv.includes('--geocode')) {
  await call('POST /places/geocode', 'POST', '/places/geocode', GeocodeSchema, { q: 'Cyber Hub Gurugram' });
}
const date = scenarios?.scenarios[0]?.date;
if (date) {
  await call(`GET /hotspots?mode=replay&date=${date}`, 'GET', `/hotspots?mode=replay&date=${date}`, HotspotsResponseSchema);
  const route = await call('POST /route (replay)', 'POST', '/route', RouteResponseSchema, {
    origin: { lat: 28.4951, lon: 77.0891, label: 'Cyber Hub' },
    destination: { lat: 28.4395, lon: 77.0422, label: 'Medanta' },
    caution: 'cautious', mode: 'replay', date,
  });
  if (route) {
    await call('GET /route/{id}', 'GET', `/route/${route.route_id}`, RouteResponseSchema);
    await call('POST /narrate', 'POST', '/narrate', NarrateResponseSchema,
      { route_id: route.route_id, user_name: 'Tanish', language: 'en' });
  }
}
process.exit(failed ? 1 : 0);
