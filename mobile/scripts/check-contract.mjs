// Checks the REAL backend's JSON against the app's zod schemas (src/api/schemas.ts).
// Usage:  npm run check:contract -- http://127.0.0.1:8000        (or set EXPO_PUBLIC_API_URL)
//         add --geocode to also test POST /places/geocode (makes one real Nominatim request)
import { GeocodeSchema, HealthSchema, PlacesSearchSchema, ScenariosSchema } from '../src/api/schemas.ts';

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) ?? process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
if (!base) {
  console.error('Give the server address, e.g. npm run check:contract -- http://127.0.0.1:8000');
  process.exit(2);
}

const checks = [
  ['GET /health', 'GET', '/health', HealthSchema],
  ['GET /scenarios', 'GET', '/scenarios', ScenariosSchema],
  ['GET /places/search?q=cyber', 'GET', '/places/search?q=cyber', PlacesSearchSchema],
];
if (args.includes('--geocode')) {
  checks.push(['POST /places/geocode', 'POST', '/places/geocode', GeocodeSchema, { q: 'Cyber Hub Gurugram' }]);
}

let failed = 0;
for (const [name, method, path, schema, body] of checks) {
  try {
    const res = await fetch(`${base}/mobile/v1${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    const parsed = schema.safeParse(json);
    if (res.ok && parsed.success) {
      console.log(`PASS  ${name}`);
    } else {
      failed++;
      console.log(`FAIL  ${name}  HTTP ${res.status}`);
      console.log(parsed.success ? json : parsed.error.issues);
    }
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}  ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
