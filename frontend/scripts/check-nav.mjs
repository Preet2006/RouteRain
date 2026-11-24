// Sanity check for phase U5, in a real browser against a running server and the REAL backend (no mocks):
//   - plans real replay trips, opens the route page, clicks "Start trip with RouteRain", runs the whole simulated drive at 10x
//   - every manoeuvre is spoken once, in order, no overlaps; the car stays on the line; the camera turns smoothly
//   - the avoided RED hotspot alert fires once, on the right side, and matches the spoken line
//   - the arrival card matches the route page; frame rate during the run
//   - blocking the map host switches to the Leaflet fallback with a notice
// Usage:  node scripts/check-nav.mjs http://127.0.0.1:8001 [outDir] [--speed=10] [--no-axe]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
const outDir = path.resolve(args.find((a) => !a.startsWith('http') && !a.startsWith('--')) ?? 'D:/ClaudeTemp/u5shots');
const SPEED = Number((args.find((a) => a.startsWith('--speed=')) ?? '--speed=10').split('=')[1]);
const runAxe = !args.includes('--no-axe');
fs.mkdirSync(outDir, { recursive: true });

const CANDIDATES = [process.env.BROWSER_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) { console.error('No Edge/Chrome found. Set BROWSER_PATH.'); process.exit(2); }

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok     ' : 'PROBLEM'} ${msg}`); if (!ok) failed++; };
const info = (msg) => console.log(`       ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRIPS = [
  { from: 'Cyber Hub', to: 'Medanta The Medicity', date: '2026-08-07', note: 'detour around a RED hotspot' },
  { from: 'MG Road Metro', to: 'Badshahpur', date: '2026-07-08', note: 'YELLOW day, roundabout' },
];

async function api(p, body) {
  const res = await fetch(`${base}/api/v2${p}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
const place = async (q) => (await api(`/places/search?q=${encodeURIComponent(q)}`)).results[0];

// ---- stand-ins injected before the page loads: a recording speech engine and a frame/state sampler ----------------
const INJECT = `(() => {
  const spoken = (window.__spoken = []);
  const stats = (window.__speech = { overlaps: 0, cancels: 0, interrupted: [] });
  let current = null;
  const voices = [{ name: 'Fake English', lang: 'en-IN', default: true, localService: true, voiceURI: 'en' }, { name: 'Fake Hindi', lang: 'hi-IN', default: false, localService: true, voiceURI: 'hi' }];
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => voices, addEventListener() {}, removeEventListener() {},
    cancel() {
      if (current) {
        stats.cancels++;
        stats.interrupted.push(current.text);
        const u = current; current = null; synth.speaking = false;
        setTimeout(() => u.onerror && u.onerror({ error: 'interrupted' }), 0);
      }
    },
    speak(u) {
      if (current) stats.overlaps++; // a second line started while one was still being spoken, without cancelling it
      current = u; synth.speaking = true;
      const map = document.querySelector('[data-testid=nav-map]');
      spoken.push({ text: u.text, lang: u.lang, t: performance.now(), lat: map && map.dataset.lat, lon: map && map.dataset.lon });
      setTimeout(() => { if (current === u) { current = null; synth.speaking = false; u.onend && u.onend({}); } }, 250 + u.text.length * 45);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = ''; this.voice = null; };

  window.__samples = [];
  window.__startSampling = () => {
    window.__fps = { deltas: [], last: performance.now(), on: true };
    const loop = (t) => { const f = window.__fps; if (!f.on) return; f.deltas.push(t - f.last); f.last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    window.__timer = setInterval(() => {
      const m = document.querySelector('[data-testid=nav-map]');
      if (!m) return;
      const alert = document.querySelector('[data-testid=nav-alert]');
      window.__samples.push({
        t: performance.now(), lat: +m.dataset.lat, lon: +m.dataset.lon, heading: +m.dataset.heading, bearing: m.dataset.bearing === undefined ? null : +m.dataset.bearing,
        zoom: m.dataset.zoom === undefined ? null : +m.dataset.zoom, alert: alert ? alert.textContent : null,
        instruction: (document.querySelector('[data-testid=nav-instruction]') || {}).textContent || null,
      });
    }, 50);
  };
  window.__stopSampling = () => { clearInterval(window.__timer); if (window.__fps) window.__fps.on = false; };
})();`;

// ---- geometry helpers (metres, local planar) -----------------------------------------------------------------------
const R = 6371008.8;
const toXY = (lat, lon, lat0) => [(lon * Math.PI / 180) * Math.cos(lat0 * Math.PI / 180) * R, (lat * Math.PI / 180) * R];
/** Distance from a point to the route line, and the distance along the route at the closest point. */
function project(geom, lat, lon) {
  const { coordinates: c, cumulative_m: cum } = geom;
  const [px, py] = toXY(lat, lon, lat);
  let best = { dist: Infinity, along: 0 };
  for (let i = 0; i < c.length - 1; i++) {
    const [ax, ay] = toXY(c[i][0], c[i][1], lat);
    const [bx, by] = toXY(c[i + 1][0], c[i + 1][1], lat);
    const dx = bx - ax, dy = by - ay, sq = dx * dx + dy * dy;
    const t = sq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / sq));
    const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    if (d < best.dist) best = { dist: d, along: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best;
}
const angDiff = (a, b) => ((b - a + 540) % 360) - 180;

// ---- the phrases the screen is expected to speak (mirrors src/lib/navPhrases.ts + prompts.ts for English) --------------
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function nowPhrase(step) {
  if (step.maneuver === 'continue') return `${step.instruction_en.split(', then ')[0]}.`;
  const first = step.instruction_en.split(', then ')[0].replace(/ onto .+$/, '');
  return step.maneuver === 'roundabout' ? `${upperFirst(first)}.` : `${upperFirst(first)} now.`;
}
function hotspotLine(e) {
  const where = e.side === 'on_route' ? 'ahead' : `to your ${e.side}`;
  if (e.avoided) return `${e.name}, rated ${e.tier}, is ${where}. Your route keeps you clear of it.`;
  if (e.passes_through) return `You are approaching ${e.name}, rated ${e.tier}. No other road avoids it.`;
  return null;
}
function expectedSpoken(dirs, destLabel, speed) {
  const out = [];
  dirs.steps.slice(1, -1).forEach((s) => {
    const roadM = dirs.steps[s.index - 1].distance_m;
    if (speed <= 5 && roadM >= 800) out.push({ at: s.start_m - 500, text: `In 500 metres, ${lowerFirst(s.instruction_en)}.` });
    if (speed <= 5 && roadM >= 300) out.push({ at: s.start_m - 150, text: `In 150 metres, ${lowerFirst(s.instruction_en)}.` });
    out.push({ at: s.start_m - 20, text: nowPhrase(s) });
  });
  dirs.hotspot_events.forEach((e) => { const t = hotspotLine(e); if (t) out.push({ at: e.approach_distance_m, text: t }); });
  out.push({ at: dirs.total_distance_m - 15, text: `You have arrived at ${destLabel}.` });
  return out.sort((a, b) => a.at - b.at).map((x) => x.text);
}

const browser = await puppeteer.launch({
  executablePath, headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...(args.includes('--software-gl') ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : [])],
});
console.log(`Browser: ${executablePath}\nServer: ${base}  speed: ${SPEED}x\n`);
{
  const probe = await browser.newPage();
  const gl = await probe.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return g ? (e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.VERSION)) : 'NO WEBGL'; });
  console.log(`WebGL: ${gl}\n`);
  await probe.close();
}

async function newPage(width = 1366, height = 768) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument(INJECT);
  await page.evaluateOnNewDocument(() => localStorage.setItem('routerain.profile', JSON.stringify({ version: 1, onboarded: true, name: 'Tanish', voiceOn: true, language: 'en', caution: 'cautious', home: null, work: null, recentTrips: [] })));
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()} @ ${m.location().url || '?'}`); });
  page.__errors = errors;
  return page;
}

const results = [];
for (const [n, trip] of TRIPS.entries()) {
  console.log(`\n======== Trip ${n + 1}: ${trip.from} -> ${trip.to} on ${trip.date} (${trip.note}) ========`);
  const [o, d] = [await place(trip.from), await place(trip.to)];
  const route = await api('/route', { origin: { lat: o.lat, lon: o.lon, label: trip.from }, destination: { lat: d.lat, lon: d.lon, label: trip.to }, caution: 'cautious', mode: 'replay', date: trip.date });
  const dirs = await api(`/route/${route.route_id}/directions?which=flood_aware`);
  info(`${dirs.steps.length} steps, ${(dirs.total_distance_m / 1000).toFixed(1)} km, ${(dirs.total_duration_s / 60).toFixed(1)} min; avoided: ${route.avoided_hotspots.map((h) => h.name).join(', ') || 'none'}`);

  const page = await newPage();
  // 1. the route page: read its numbers, then click the Start button
  await page.goto(`${base}/route/${route.route_id}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('table.rr-compare');
  const table = await page.$$eval('table.rr-compare tbody tr', (rows) => Object.fromEntries(rows.map((r) => [r.querySelector('th').textContent, [...r.querySelectorAll('td')].map((c) => c.textContent)])));
  const startBtn = await page.$('a.rr-start-btn');
  check(!!startBtn && (await page.$eval('a.rr-start-btn', (e) => e.textContent)) === 'Start trip with RouteRain', 'route page has the "Start trip with RouteRain" button');
  check(!!(await page.$('a.rr-start-preview')), 'route page has the "Preview the usual route" link');
  const startBox = await startBtn.boundingBox();
  info(`start button ${Math.round(startBox.width)}x${Math.round(startBox.height)} px`);
  await page.screenshot({ path: path.join(outDir, `trip${n + 1}-route-page.png`) });
  await startBtn.click();
  await page.waitForSelector('[data-testid=nav-screen]', { timeout: 30000 });
  check(new URL(page.url()).pathname === `/navigate/${route.route_id}`, 'Start opens /navigate/:routeId');
  await page.evaluate((s) => [...document.querySelectorAll('.rr-drive-seg button')].find((b) => b.textContent === `${s}×`)?.click(), SPEED);
  await page.evaluate(() => window.__startSampling());
  const heldAtStart = await page.evaluate(() => !!document.querySelector('[data-testid=nav-starting]'));
  info(`car waits at the start while the opening line is spoken: ${heldAtStart}`);

  // 2. map engine + first frame
  await page.waitForFunction(() => { const m = document.querySelector('[data-testid=nav-map]'); return m && m.dataset.lat; }, { timeout: 30000 });
  const engine = await page.$eval('[data-testid=nav-map]', (e) => e.dataset.engine);
  info(`map engine: ${engine}`);
  check(engine === 'maplibre', 'the 3D map (MapLibre + OpenFreeMap) is in use');
  // the style, sprites and first tiles come from the OpenFreeMap host: wait for the attribution text it brings
  await page.waitForFunction(() => (document.querySelector('.maplibregl-ctrl-attrib')?.textContent || '').trim().length > 0, { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: path.join(outDir, `trip${n + 1}-nav-start.png`) });
  const chrome = await page.evaluate(() => ({ header: !!document.querySelector('header.rr-header, .rr-shell'), tabs: !!document.querySelector('nav[aria-label=Main]'), attribution: (document.querySelector('.maplibregl-ctrl-attrib')?.textContent || '').trim() }));
  check(!chrome.header && !chrome.tabs, 'full screen: no site header or tab bar');
  check(/OpenStreetMap/i.test(chrome.attribution), `OpenStreetMap attribution text present ("${chrome.attribution.slice(0, 70)}")`);
  const credit = await page.evaluate(() => {
    const el = document.querySelector('.maplibregl-ctrl-attrib');
    const bar = document.querySelector('.rr-drive-bar');
    if (!el || !bar) return null;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { bottom: Math.round(r.bottom), barTop: Math.round(bar.getBoundingClientRect().top), onTop: !!top && el.contains(top) };
  });
  check(!!credit && credit.bottom <= credit.barTop + 1 && credit.onTop, `the map credits are really visible: above the bottom bar (${credit ? credit.bottom : '?'} <= ${credit ? credit.barTop : '?'}) and not covered by anything`);
  const badges = await page.$$eval('.rr-drive-badge', (b) => b.map((x) => x.textContent));
  check(badges.includes('Simulated drive') && badges.some((x) => x.startsWith('Replay:')), `badges: ${badges.join(' | ')}`);

  if (runAxe && n === 0) {
    // evaluated directly (not as a <script>), so the site's real Content-Security-Policy stays in force for this whole run
    await page.evaluate(fs.readFileSync(require.resolve('axe-core'), 'utf8'));
    const axe = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((v) => `${v.id} (${v.nodes.length}x): ${v.nodes.slice(0, 2).map((x) => x.target.join(' ')).join(' | ')}`));
    check(axe.length === 0, `axe: ${axe.length ? axe.join(' ;; ') : 'no violations on the navigation screen'}`);
    // axe fetches cross-origin stylesheets (the Google Fonts @import) to check contrast, which the site's CSP blocks: not a page error
    page.__errors = page.__errors.filter((e) => !/fonts\.googleapis\.com/.test(e));
  }

  // 3. run the whole drive at the chosen speed
  const t0 = Date.now();
  let alertShot = false;
  const budgetMs = (dirs.total_duration_s / SPEED) * 1000 + 90_000;
  while (Date.now() - t0 < budgetMs) {
    if (await page.$('[data-testid=nav-arrival]')) break;
    if (!alertShot && (await page.$('[data-testid=nav-alert]'))) { alertShot = true; await page.screenshot({ path: path.join(outDir, `trip${n + 1}-nav-alert.png`) }); }
    await sleep(250);
  }
  const arrived = !!(await page.$('[data-testid=nav-arrival]'));
  check(arrived, `the drive reached the arrival screen in ${((Date.now() - t0) / 1000).toFixed(0)} s (route ${(dirs.total_duration_s).toFixed(0)} s at ${SPEED}x)`);
  await sleep(600);
  await page.screenshot({ path: path.join(outDir, `trip${n + 1}-nav-arrived.png`) });
  const run = await page.evaluate(() => { window.__stopSampling(); return { samples: window.__samples, spoken: window.__spoken, speech: window.__speech, deltas: window.__fps.deltas }; });

  // --- spoken lines
  const said = run.spoken.map((s) => s.text);
  const expected = expectedSpoken(dirs, trip.to, SPEED);
  check(said[0].endsWith('.') && /Head [a-z]+/.test(said[0]), `first line = summary + first direction: "${said[0].slice(0, 160)}${said[0].length > 160 ? '…' : ''}"`);
  const rest = said.slice(1);
  check(JSON.stringify(rest) === JSON.stringify(expected), `every manoeuvre spoken once, in order (${rest.length} lines after the start line; expected ${expected.length})`);
  if (JSON.stringify(rest) !== JSON.stringify(expected)) { info('spoken:   ' + JSON.stringify(rest)); info('expected: ' + JSON.stringify(expected)); }
  check(run.speech.overlaps === 0, `no overlapping speech (two lines at once): ${run.speech.overlaps}`);
  check(!run.speech.interrupted.some((t) => t === said[0]), 'the opening line is spoken to the end (the car waits for it)');
  info(`lines cut off by the next line: ${run.speech.interrupted.length}${run.speech.interrupted.length ? ' -> ' + run.speech.interrupted.map((t) => `"${t.slice(0, 40)}"`).join(', ') : ''}`);
  check(said.filter((t) => t === `You have arrived at ${trip.to}.`).length === 1, 'arrival line spoken exactly once');

  // --- the car stays on the line, and moves forward only
  let worst = 0, back = 0, prevAlong = -1, worstSample = null;
  const valid = run.samples.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  info(`${valid.length} position samples (${run.samples.length - valid.length} taken before the first frame were ignored)`);
  const withAlong = valid.map((s) => { const p = project(dirs.geometry, s.lat, s.lon); if (p.dist > worst) { worst = p.dist; worstSample = s; } if (p.along < prevAlong - 0.5) back++; prevAlong = Math.max(prevAlong, p.along); return { ...s, along: p.along }; });
  if (worst > 1) info(`worst sample: ${JSON.stringify(worstSample)}`);
  check(worst < 1.0, `the car stays on the route line (worst distance from it ${worst.toFixed(2)} m over ${valid.length} samples)`);
  check(back === 0, 'the car never moves backwards');

  // --- camera smoothness (heading-up rotation)
  const cam = run.samples.filter((s) => s.bearing !== null);
  let maxStep = 0, maxRate = 0, maxZoomStep = 0, jumps = 0;
  for (let i = 1; i < cam.length; i++) {
    const dt = (cam[i].t - cam[i - 1].t) / 1000;
    const step = Math.abs(angDiff(cam[i - 1].bearing, cam[i].bearing));
    maxStep = Math.max(maxStep, step);
    if (dt > 0) maxRate = Math.max(maxRate, step / dt);
    maxZoomStep = Math.max(maxZoomStep, Math.abs(cam[i].zoom - cam[i - 1].zoom));
    if (step > 30) jumps++;
  }
  check(cam.length > 20 && jumps === 0, `camera heading-up rotation is smooth: biggest change between 50 ms samples ${maxStep.toFixed(1)} deg, fastest ${maxRate.toFixed(0)} deg/s, biggest zoom step ${maxZoomStep.toFixed(2)}`);
  const turned = cam.length ? Math.max(...cam.map((s) => Math.abs(angDiff(cam[0].bearing, s.bearing)))) : 0;
  check(turned > 45, `the map really does rotate with the car (up to ${turned.toFixed(0)} deg from the start heading)`);

  // --- hotspot alert
  const alerts = withAlong.filter((s) => s.alert);
  const spokenHot = said.filter((t) => /rated (RED|YELLOW)/.test(t));
  const eventsSpoken = dirs.hotspot_events.map(hotspotLine).filter(Boolean);
  check(spokenHot.length === eventsSpoken.length && JSON.stringify(spokenHot) === JSON.stringify(eventsSpoken), `hotspot line spoken once per avoided/through hotspot (${spokenHot.length}): ${spokenHot.join(' / ') || 'none'}`);
  if (eventsSpoken.length) {
    let windows = 0, was = false;
    withAlong.forEach((s) => { if (s.alert && !was) windows++; was = !!s.alert; });
    const first = alerts[0];
    info(`alert windows: ${windows}${first ? `; first alert at ${first.along.toFixed(0)} m along the route` : ''}`);
    check(windows >= 1 && windows <= dirs.hotspot_events.filter((e) => e.avoided || e.passes_through).length, 'the hotspot alert appears once per hotspot (not flickering)');
    const ev = dirs.hotspot_events.find((e) => e.avoided || e.passes_through);
    check(!first || first.along >= ev.approach_distance_m - 40, `alert not earlier than the 1 km mark (${first ? first.along.toFixed(0) : '-'} >= ${ev.approach_distance_m})`);
    check(alerts.every((s) => s.alert.includes(ev.side === 'on_route' ? 'ahead' : `to your ${ev.side}`) || dirs.hotspot_events.length > 1), `alert text names the right side (${ev.side})`);
    check(alerts.some((s) => hotspotLine(ev) && s.alert.includes(hotspotLine(ev))), 'alert banner text matches the spoken line');
  }

  // --- arrival numbers vs the route page
  const arrival = await page.evaluate(() => ({ time: document.querySelector('[data-testid=arrival-time]').textContent, km: document.querySelector('[data-testid=arrival-km]').textContent, avoided: document.querySelector('[data-testid=arrival-avoided]').textContent }));
  check(arrival.time === table['Drive time'][1] && arrival.km === table['Distance'][1], `arrival card ${arrival.time}, ${arrival.km} = route page RouteRain column (${table['Drive time'][1]}, ${table['Distance'][1]})`);
  check(arrival.avoided === (route.avoided_hotspots.map((h) => h.name).join(', ') || 'None'), `hotspots avoided: ${arrival.avoided}`);
  const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('routerain.profile')).recentTrips[0]);
  check(recent && recent.destination.label === trip.to, 'the trip is saved to recent trips');

  // --- frame rate
  const deltas = run.deltas.slice(5);
  const avgMs = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const sorted = [...deltas].sort((a, b) => a - b);
  info(`frame rate during the run: average ${(1000 / avgMs).toFixed(1)} fps (median frame ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms, 95th percentile ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms, worst ${sorted[sorted.length - 1].toFixed(0)} ms, ${deltas.length} frames)`);
  results.push({ trip: n + 1, fps: 1000 / avgMs });

  // --- End trip stops everything (second run of the same trip, ended half way)
  await page.goto(`${base}/navigate/${route.route_id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=nav-screen]', { timeout: 30000 });
  await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll('.rr-drive-controls button')].find((b) => b.textContent === 'End trip')?.click());
  await sleep(500);
  const navLine = (t) => /now\.$|^In \d+ metres|^You have arrived|keeps you clear|No other road avoids|^Continue onto|^At the roundabout/.test(t);
  const afterEnd = await page.evaluate(() => ({ path: location.pathname, spoken: window.__spoken.map((x) => x.text) }));
  await sleep(2500);
  const later = await page.evaluate(() => ({ spoken: window.__spoken.map((x) => x.text) }));
  const laterNav = later.spoken.slice(afterEnd.spoken.length).filter(navLine);
  check(afterEnd.path === `/route/${route.route_id}` && laterNav.length === 0, `End trip returns to the route page and no navigation line is spoken afterwards (${laterNav.length})`);

  check(page.__errors.length === 0, `no console or page errors${page.__errors.length ? ': ' + page.__errors.slice(0, 3).join(' | ') : ''}`);
  await page.close();
}

// ---- map host blocked -> Leaflet fallback ------------------------------------------------------------------------------
console.log('\n======== Style load failure (tiles.openfreemap.org blocked) ========');
{
  const trip = TRIPS[0];
  const [o, d] = [await place(trip.from), await place(trip.to)];
  const route = await api('/route', { origin: { lat: o.lat, lon: o.lon, label: trip.from }, destination: { lat: d.lat, lon: d.lon, label: trip.to }, caution: 'cautious', mode: 'replay', date: trip.date });
  const page = await newPage();
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().includes('tiles.openfreemap.org') ? r.abort('blockedbyclient') : r.continue()));
  await page.goto(`${base}/navigate/${route.route_id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=nav-fallback-notice]', { timeout: 40000 });
  const engine = await page.$eval('[data-testid=nav-map]', (e) => e.dataset.engine);
  const notice = await page.$eval('[data-testid=nav-fallback-notice]', (e) => e.textContent);
  check(engine === 'leaflet', 'the Leaflet fallback map is shown');
  check(/north-up/i.test(notice), `notice shown: "${notice}"`);
  await page.evaluate(() => window.__startSampling());
  await sleep(14000); // the car waits at the start while the opening line is spoken
  const moved = await page.evaluate(() => { const s = window.__samples; return s.length > 5 && (s[s.length - 1].lat !== s[0].lat || s[s.length - 1].lon !== s[0].lon); });
  check(moved, 'the car keeps moving on the fallback map');
  const instruction = await page.$eval('[data-testid=nav-instruction]', (e) => e.textContent);
  check(!!instruction, `directions still work on the fallback (next: "${instruction}")`);
  await page.screenshot({ path: path.join(outDir, 'fallback-nav.png') });
  await page.close();
}

// ---- phone-size screenshot ---------------------------------------------------------------------------------------------
{
  const trip = TRIPS[0];
  const [o, d] = [await place(trip.from), await place(trip.to)];
  const route = await api('/route', { origin: { lat: o.lat, lon: o.lon, label: trip.from }, destination: { lat: d.lat, lon: d.lon, label: trip.to }, caution: 'cautious', mode: 'replay', date: trip.date });
  const page = await newPage(390, 844);
  await page.goto(`${base}/navigate/${route.route_id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-testid=nav-map]')?.dataset.lat, { timeout: 30000 });
  await sleep(3000);
  await page.screenshot({ path: path.join(outDir, 'nav-phone.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'phone width (390 px): no horizontal overflow');
  await page.close();
}

await browser.close();
console.log(`\nScreenshots in ${outDir}`);
console.log(failed ? `\n${failed} problem(s)` : '\nAll U5 browser checks passed.');
process.exit(failed ? 1 : 0);
