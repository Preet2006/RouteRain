// Sanity check for phase U2: the hotspot CARDS and DETAIL pages must show exactly what the REAL /api/v2 returns.
// For one live and one replay scenario it builds every card with the site's own display logic and compares it with the
// API item; it then loads three detail pages (including a LOW RAIN one) and checks them against the list, the buffer
// rule and the recorded-flood counts in data/processed/flood_labels_clean.csv.
// Usage:  npm run check:cards -- http://127.0.0.1:8000 [replayDate] [lowRainDate]
import fs from 'node:fs';
import path from 'node:path';

import { HotspotDetailSchema, HotspotsResponseSchema } from '../src/api/schemas.ts';
import { cardModel, conditionRows, filterAndSort, historyText, sinkText } from '../src/features/hotspots/model.ts';
import { probabilityBand } from '../src/features/hotspots/markers.ts';

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const replayDate = dates[0] ?? '2026-08-07';
const lowRainDate = dates[1] ?? '2025-07-09';
let failed = 0;
const bad = (msg) => { failed++; console.log('  problem:', msg); };

const labels = fs.readFileSync(path.resolve(import.meta.dirname, '../../data/processed/flood_labels_clean.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
const floods = {};
labels.forEach((l) => { const id = l.split(',')[0]; floods[id] = (floods[id] ?? 0) + 1; });

async function get(p) {
  const res = await fetch(`${base}/api/v2${p}`);
  return { status: res.status, json: await res.json() };
}

async function cards(label, query, replay) {
  const { status, json } = await get(`/hotspots${query}`);
  const parsed = HotspotsResponseSchema.safeParse(json);
  if (status !== 200 || !parsed.success) { bad(`${label}: HTTP ${status} ${parsed.success ? '' : JSON.stringify(parsed.error.issues).slice(0, 200)}`); return null; }
  const { hotspots } = parsed.data;
  console.log(`\n${label}: ${hotspots.length} cards`);
  console.log('id   tier      risk                          area                       reason (first 58 chars)                                reported');
  for (const h of filterAndSort(hotspots, 'ALL', 'risk')) {
    const c = cardModel(h, replay);
    console.log(`${c.id.padEnd(4)} ${c.word.padEnd(9)} ${c.risk.padEnd(29)} ${c.area.padEnd(26)} ${c.reason.slice(0, 58).padEnd(58)} ${c.reported ?? '-'}`);
    if (c.name !== h.name || c.tier !== h.tier) bad(`${c.id}: name or tier differs from the API`);
    const band = probabilityBand(h.probability);
    if (h.tier === 'LOW_RAIN' ? c.risk !== 'Not scored, under 10 mm rain' : c.risk !== `about ${band}`) bad(`${c.id}: risk text does not match the probability`);
    if (h.tier === 'LOW_RAIN' && /%/.test(c.risk)) bad(`${c.id}: LOW RAIN card shows a percentage`);
    if (!c.area) bad(`${c.id}: no area line`);
    if (!c.reason || c.reason === h.explanation && h.explanation.length > 160) bad(`${c.id}: reason is empty or is the whole explanation`);
    if (replay !== (c.reported !== null)) bad(`${c.id}: reported-that-day line ${replay ? 'missing' : 'present'}`);
  }
  if (hotspots.length !== 12) bad(`${label}: expected 12 hotspots`);
  return hotspots;
}

async function detail(id, mode, date, list) {
  const q = `?mode=${mode}${date ? `&date=${date}` : ''}`;
  const { status, json } = await get(`/hotspots/${id}${q}`);
  const parsed = HotspotDetailSchema.safeParse(json);
  if (status !== 200 || !parsed.success) { bad(`detail ${id} ${mode}: HTTP ${status} ${parsed.success ? '' : JSON.stringify(parsed.error.issues).slice(0, 300)}`); return; }
  const d = parsed.data;
  const item = list.find((x) => x.id === id);
  const wantBuffer = d.hotspot.tier === 'RED' ? 500 : 300;
  console.log(`\ndetail ${id} ${d.hotspot.name} [${mode}${date ? ' ' + date : ''}] tier ${d.hotspot.tier}, p=${d.hotspot.probability}, zone ${d.buffer_m} m`);
  console.log(`  area: ${d.hotspot.type} | ground: elevation ${Math.round(d.terrain.elevation_m)} m, ${sinkText(d.terrain.sink_depth_m)}`);
  const rows = conditionRows(d.conditions);
  console.log('  conditions:', rows ? rows.map((r) => `${r.label.split(' (')[0]} ${r.value}`).join(' | ') : 'none (not scored)');
  console.log(`  floods: ${historyText(d.history)} | infrastructure: ${d.infrastructure.flagged ? 'FLAGGED, ' + (d.infrastructure.note ?? '').slice(0, 70) + '...' : 'none'}`);
  if (JSON.stringify(d.hotspot) !== JSON.stringify(item)) bad(`${id}: detail hotspot differs from the list item`);
  if (d.buffer_m !== wantBuffer) bad(`${id}: buffer ${d.buffer_m}, expected ${wantBuffer}`);
  if (d.hotspot.tier === 'LOW_RAIN') {
    if (d.conditions !== null || d.hotspot.probability !== null) bad(`${id}: LOW RAIN detail has conditions or a probability`);
  } else if (d.conditions === null) bad(`${id}: scored hotspot has no conditions`);
  else if (d.conditions.rain_max_1h > d.conditions.rain_24h + 1e-6) bad(`${id}: heaviest hour exceeds the day's rain`);
  if (d.history.recorded_floods !== (floods[id] ?? 0)) bad(`${id}: ${d.history.recorded_floods} floods, CSV has ${floods[id] ?? 0}`);
  if (d.infrastructure.flagged && !d.infrastructure.note) bad(`${id}: flagged infrastructure without a note`);
}

const live = await cards('LIVE', '?mode=live', false);
const replay = await cards(`REPLAY ${replayDate}`, `?mode=replay&date=${replayDate}`, true);
const low = await cards(`REPLAY ${lowRainDate} (has a LOW RAIN hotspot)`, `?mode=replay&date=${lowRainDate}`, true);
if (replay && low) {
  const lowId = low.find((h) => h.tier === 'LOW_RAIN')?.id;
  if (!lowId) bad(`${lowRainDate}: expected a LOW RAIN hotspot`);
  await detail('H02', 'replay', replayDate, replay);        // a scored, RED hotspot with an infrastructure note
  await detail('H03', 'live', null, live);                  // live mode
  if (lowId) await detail(lowId, 'replay', lowRainDate, low); // a LOW RAIN hotspot
}
const missing = await get('/hotspots/H99?mode=live');
console.log(`\nunknown id -> HTTP ${missing.status} "${missing.json.detail}"`);
if (missing.status !== 404) bad('unknown hotspot id should be 404');
console.log(failed ? `\nFAILED: ${failed} problem(s)` : '\nAll card and detail checks passed.');
process.exit(failed ? 1 : 0);
