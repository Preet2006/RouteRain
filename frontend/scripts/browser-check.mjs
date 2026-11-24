// Real-browser check (Microsoft Edge or Chrome, headless) for phase W8 and the demo rehearsal.
// For each page at 360, 768, 1366 and 1920 px wide it takes a screenshot, detects horizontal overflow, and runs the
// axe accessibility audit (WCAG 2.x A/AA incl. colour contrast). Needs the site served, e.g. by uvicorn.
//
// Usage: npm run check:browser -- http://127.0.0.1:8000 [outDir] [--demo] [--axe-only] [--keyboard]
//   BROWSER_PATH=...   to override the browser executable
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
const outDir = args.find((a) => !a.startsWith('http') && !a.startsWith('--')) ?? path.join(process.cwd(), 'browser-check-out');
const flag = (f) => args.includes(f);
const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) { console.error('No Edge/Chrome found. Set BROWSER_PATH.'); process.exit(2); }

const VIEWPORTS = [[360, 740], [768, 1024], [1366, 768], [1920, 1080]];
const PROFILE = { version: 1, name: 'Tanish', home: { label: 'Sector 29', lat: 28.467, lon: 77.065 }, work: { label: 'Cyber Hub', lat: 28.4951, lon: 77.0891 },
  voiceOn: true, language: 'en', caution: 'cautious', recentTrips: [], onboarded: true };
fs.mkdirSync(outDir, { recursive: true });

async function api(p, body) {
  const res = await fetch(`${base}/api/v2${p}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body && JSON.stringify(body) });
  return res.json();
}

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const problems = [];
const summary = [];

async function open(width, height, { profile = PROFILE, replay = true, demo = false, splash = false } = {}) {
  const page = await browser.newPage();
  await page.setBypassCSP(true); // only so axe can be injected; the site's own CSP stays strict
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((p, r, d, sp) => {
    try {
      if (!sp) sessionStorage.setItem('routerain.splash', '1'); // skip the entry screen unless it is being tested
      if (p) localStorage.setItem('routerain.profile', JSON.stringify(p)); else localStorage.removeItem('routerain.profile');
      if (r) sessionStorage.setItem('routerain.scenario', JSON.stringify({ mode: 'replay', date: '2026-08-07' }));
      if (d) localStorage.setItem('routerain.demo', '1');
    } catch { /* storage blocked */ }
  }, profile, replay, demo, splash);
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
  return page;
}

async function audit(page, name, width) {
  await page.addScriptTag({ path: require.resolve('axe-core') });
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
      sample: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(1, 3).join(' ').trim() })) }));
  });
  const overflow = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    offenders: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed'
      && !e.closest('.leaflet-container') && !e.closest('.rr-table-wrap')).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`) }));
  const horizontal = overflow.scrollW > overflow.innerW + 1;
  summary.push({ page: name, width, axe: axe.length, overflow: horizontal });
  axe.forEach((v) => problems.push(`[axe ${v.impact}] ${name} @${width}: ${v.id} (${v.nodes}x) ${v.help} :: ${v.sample.map((s) => `${s.target} ${s.summary}`).join(' | ')}`));
  if (horizontal) problems.push(`[overflow] ${name} @${width}: page is ${overflow.scrollW}px wide in a ${overflow.innerW}px window (${overflow.offenders.join(', ')})`);
}


// Full-screen check: no boxed container, map pages fill the window without page scroll, the map is most of the width.
const layoutRows = [];
async function layout(page, name, kind, w, h) {
  const m = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const q = e.getBoundingClientRect(); return { left: Math.round(q.left), width: Math.round(q.width), height: Math.round(q.height) }; };
    return { main: r('.rr-main'), map: r('.rr-map'), scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
  });
  const row = { page: name, vp: `${w}x${h}`, mainW: m.main ? m.main.width : '-', mainLeft: m.main ? m.main.left : '-', mapW: m.map ? m.map.width : '-', mapPct: m.map ? Math.round(100 * m.map.width / w) : '-', mapH: m.map ? m.map.height : '-', pageScrolls: m.scrollH > m.innerH + 1 };
  layoutRows.push(row);
  if (kind !== 'entry' && m.main && (m.main.width < w - 1 || m.main.left !== 0)) problems.push(`[layout] ${name} @${w}: content is boxed (${m.main.width}px wide, left ${m.main.left})`);
  if (kind === 'map' && m.scrollH > m.innerH + 1) problems.push(`[layout] ${name} @${w}: page scrolls (${m.scrollH}px in a ${m.innerH}px window) instead of filling the screen`);
  if (kind === 'map' && w >= 1366 && m.map && m.map.width < w * 0.5) problems.push(`[layout] ${name} @${w}: map is only ${Math.round(100 * m.map.width / w)}% of the width`);
}

async function shoot(page, name, width) {
  await page.screenshot({ path: path.join(outDir, `${name}-${width}.png`), fullPage: false });
}

const demo = flag('--demo');
const route = demo ? { route_id: 'demo-trip-1' } : await api('/route', {
  origin: { lat: 28.4951, lon: 77.0891, label: 'Cyber Hub' }, destination: { lat: 28.4395, lon: 77.0422, label: 'Medanta The Medicity' },
  caution: 'cautious', mode: 'replay', date: '2026-08-07' });
const PAGES = [
  ['entry', '/', '.rr-entry-name', 'entry'],
  ['plan', '/plan', 'form[aria-label="Plan a trip"]', 'map'],
  ['hotspots', '/hotspots', '.rr-home-panel h1', 'map'],
  ['route', `/route/${route.route_id}`, '[data-testid="advice-text"]', 'map'],
  ['settings', '/settings', '.rr-text h1', 'text'],
  ['about', '/about', '.rr-text h1', 'text'],
];

for (const [w, h] of VIEWPORTS) {
  for (const [name, url, ready, kind] of PAGES) {
    const page = await open(w, h, { demo });
    try {
      await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector(ready, { timeout: 30000 });
      if (name === 'hotspots') await page.waitForSelector('.rr-marker', { timeout: 60000 }).catch(() => problems.push(`[home] no markers at ${w}`));
      await new Promise((r) => setTimeout(r, 1200)); // let tiles/fly animations settle
      await shoot(page, name, w);
      if (!flag('--no-axe')) await audit(page, name, w);
      await layout(page, name, kind, w, h);
    } catch (e) { problems.push(`[load] ${name} @${w}: ${e.message}`); }
    await page.close();
  }
  // first-run pages (no profile)
  for (const [name, url, ready] of [['setup', '/setup', 'h1']]) {
    const page = await open(w, h, { profile: null, replay: false });
    try {
      await page.goto(base + url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(ready, { timeout: 15000 });
      await shoot(page, name, w);
      if (!flag('--no-axe')) await audit(page, name, w);
    } catch (e) { problems.push(`[load] ${name} @${w}: ${e.message}`); }
    await page.close();
  }
}

console.log(`Browser: ${executablePath}`);
console.table(summary);
console.log('\nLayout (full-screen check):');
console.table(layoutRows);
console.log(problems.length ? `\n${problems.length} problem(s):\n- ${[...new Set(problems)].join('\n- ')}` : '\nNo accessibility violations, no horizontal overflow, no console errors.');
console.log(`Screenshots: ${outDir}`);
await browser.close();
process.exit(problems.length ? 1 : 0);
