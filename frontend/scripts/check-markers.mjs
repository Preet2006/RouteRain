// Sanity check for phase W5: for one live and two replay scenarios, fetch the REAL /api/v2/hotspots and verify that
// every one of the 12 hotspots gets exactly one map marker whose text, colour and accessible name match the API.
// Usage:  npm run check:markers -- http://127.0.0.1:8000 [replayDate replayDate]
import { HotspotsResponseSchema } from '../src/api/schemas.ts';
import { markerSpec, probabilityBand } from '../src/features/home/markers.ts';
import { tierInfo } from '../src/theme/tiers.ts';

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const replayDates = dates.length ? dates : ['2026-08-07', '2025-07-09'];
let failed = 0;

async function check(label, query) {
  const res = await fetch(`${base}/api/v2/hotspots${query}`);
  const parsed = HotspotsResponseSchema.safeParse(await res.json());
  if (!res.ok || !parsed.success) {
    failed++;
    console.log(`FAIL  ${label}: HTTP ${res.status} ${parsed.success ? '' : JSON.stringify(parsed.error.issues).slice(0, 300)}`);
    return;
  }
  const { hotspots, tiers, scenario } = parsed.data;
  const specs = hotspots.map(markerSpec);
  const problems = [];
  if (hotspots.length !== 12) problems.push(`expected 12 hotspots, got ${hotspots.length}`);
  if (new Set(specs.map((s) => s.id)).size !== hotspots.length) problems.push('duplicate marker ids');
  for (const t of ['RED', 'YELLOW', 'GREEN', 'LOW_RAIN']) {
    const n = hotspots.filter((h) => h.tier === t).length;
    if (n !== tiers[t]) problems.push(`tier count ${t}: response says ${tiers[t]}, list has ${n}`);
  }
  hotspots.forEach((h, i) => {
    const s = specs[i];
    const t = tierInfo(h.tier);
    if (s.tier !== h.tier || s.color !== t.color) problems.push(`${h.id}: wrong tier/colour`);
    if (!s.text.includes(t.word) || !s.text.includes(t.glyph)) problems.push(`${h.id}: marker text lacks word or glyph`);
    if (!s.ariaLabel.startsWith(`${h.name}: `)) problems.push(`${h.id}: accessible name missing`);
    if (h.tier === 'LOW_RAIN' && (h.probability !== null || probabilityBand(h.probability) !== null)) problems.push(`${h.id}: LOW_RAIN has a probability`);
    if (h.tier !== 'LOW_RAIN' && h.probability === null) problems.push(`${h.id}: scored hotspot has no probability`);
    if (scenario.mode === 'live' && h.reported_outcome !== null) problems.push(`${h.id}: live hotspot carries a reported outcome`);
  });
  console.log(`\n${problems.length ? 'FAIL' : 'PASS'}  ${label}  (${scenario.mode}${scenario.date ? ' ' + scenario.date : ''})  ` +
    `RED ${tiers.RED} / YELLOW ${tiers.YELLOW} / GREEN ${tiers.GREEN} / LOW RAIN ${tiers.LOW_RAIN}`);
  console.log('id   name                 tier      prob   band         marker text       reported');
  for (const [i, h] of hotspots.entries()) {
    console.log(`${h.id.padEnd(4)} ${h.name.padEnd(20)} ${h.tier.padEnd(9)} ${(h.probability === null ? '-' : h.probability.toFixed(4)).padEnd(6)} ` +
      `${(probabilityBand(h.probability) ?? '-').padEnd(12)} ${specs[i].text.padEnd(17)} ${h.reported_outcome ?? '-'}`);
  }
  problems.forEach((p) => console.log('  problem:', p));
  if (problems.length) failed++;
}

await check('live', '?mode=live');
for (const d of replayDates) await check(`replay ${d}`, `?mode=replay&date=${d}`);
process.exit(failed ? 1 : 0);
