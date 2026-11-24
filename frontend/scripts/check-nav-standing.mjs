// Quick real-browser check of the standing navigation screen and the hotspot cards.
//   - /navigate/:id opens still (nothing moves, nothing is spoken, no speed selector, no "Simulated drive" badge)
//   - "Show live run" starts the drive and reads only the first direction (not the advice again)
//   - the advice on the route page is read once, and not again when coming back to it
// Usage: node scripts/check-nav-standing.mjs http://127.0.0.1:8001 [outDir]
import fs from 'node:fs';
import path from 'node:path';

import puppeteer from 'puppeteer-core';

const base = (process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
const outDir = process.argv.find((a) => !a.startsWith('http') && !a.includes('check-nav') && !a.endsWith('node.exe') && a.length > 3 && !a.includes('node')) ?? 'D:/ClaudeTemp/u5shots';
fs.mkdirSync(outDir, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok     ' : 'PROBLEM'} ${msg}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => (await fetch(`${base}/api/v2${p}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body && JSON.stringify(body) })).json();

const INJECT = `(() => {
  window.__spoken = [];
  const synth = { speaking: false, getVoices: () => [{ name: 'Fake', lang: 'en-IN', default: true }], addEventListener() {}, removeEventListener() {},
    cancel() { synth.speaking = false; }, speak(u) { window.__spoken.push(u.text); synth.speaking = true; setTimeout(() => { synth.speaking = false; u.onend && u.onend({}); }, 300); } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: true, isActive: true }, configurable: true });
})();`;

const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
await page.evaluateOnNewDocument(INJECT);
await page.evaluateOnNewDocument(() => localStorage.setItem('routerain.profile', JSON.stringify({ version: 1, onboarded: true, name: 'Tanish', voiceOn: true, language: 'en', caution: 'cautious', home: null, work: null, recentTrips: [] })));

const place = async (q) => (await api(`/places/search?q=${encodeURIComponent(q)}`)).results[0];
const [o, d] = [await place('Cyber Hub'), await place('Medanta The Medicity')];
const route = await api('/route', { origin: { lat: o.lat, lon: o.lon, label: 'Cyber Hub' }, destination: { lat: d.lat, lon: d.lon, label: 'Medanta' }, caution: 'cautious', mode: 'replay', date: '2026-08-07' });

// the route page reads the advice once
await page.goto(`${base}/route/${route.route_id}`, { waitUntil: 'networkidle0' });
await sleep(1500);
const afterFirst = await page.evaluate(() => window.__spoken.length);
check(afterFirst === 1, `route page reads the advice once (${afterFirst} line)`);

// Start -> the standing screen
await page.click('a.rr-start-btn');
await page.waitForSelector('[data-testid=nav-screen]');
await page.waitForFunction(() => document.querySelector('[data-testid=nav-map]')?.dataset.lat, { timeout: 30000 });
await sleep(3500);
const standing = await page.evaluate(() => ({
  spoken: window.__spoken.length,
  lat0: document.querySelector('[data-testid=nav-map]').dataset.lat,
  seg: !!document.querySelector('.rr-drive-seg'),
  sim: [...document.querySelectorAll('.rr-drive-badge')].some((b) => b.textContent === 'Simulated drive'),
  run: [...document.querySelectorAll('button')].some((b) => b.textContent === 'Show live run'),
  dist: document.querySelector('[data-testid=nav-distance]').textContent,
}));
await page.screenshot({ path: path.join(outDir, 'standing-nav.png') });
await sleep(1500);
const lat1 = await page.evaluate(() => document.querySelector('[data-testid=nav-map]').dataset.lat);
check(standing.run && !standing.seg && !standing.sim, 'standing view: "Show live run" button, no speed selector, no "Simulated drive" badge');
check(standing.spoken === afterFirst, 'nothing is spoken when the trip screen opens (the advice is not read again)');
check(standing.lat0 === lat1, 'the car stands still until "Show live run"');

await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Show live run').click());
await sleep(4000);
const running = await page.evaluate(() => ({ spoken: window.__spoken.slice(), lat: document.querySelector('[data-testid=nav-map]').dataset.lat, pause: [...document.querySelectorAll('button')].some((b) => b.textContent === 'Pause') }));
check(running.spoken.length === afterFirst + 1 && /^Head [a-z]+/.test(running.spoken[running.spoken.length - 1]) && running.spoken[running.spoken.length - 1].length < 60, `live run reads only the first direction: "${running.spoken[running.spoken.length - 1]}"`);
check(running.lat !== lat1 && running.pause, 'the car drives and a Pause button replaces "Show live run"');
await page.screenshot({ path: path.join(outDir, 'running-nav.png') });

// back to the route page: no second automatic reading
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'End trip').click());
await sleep(2500);
const afterBack = await page.evaluate(() => window.__spoken.slice());
check(afterBack.length === running.spoken.length, 'coming back to the route page does not read the advice again');

// hotspot cards
await page.goto(`${base}/hotspots?replay=2026-08-07`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.rr-hcard', { timeout: 60000 });
await sleep(500);
await page.screenshot({ path: path.join(outDir, 'hotspot-cards.png') });
check((await page.$$('.rr-hcard')).length === 12, '12 hotspot cards shown (live or replay data loads without error)');
await browser.close();
console.log(failed ? `\n${failed} problem(s)` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
