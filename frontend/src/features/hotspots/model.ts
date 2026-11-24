/**
 * Pure display logic for the Hotspots pages: no React, no DOM. Imports only the tier helper and types (with explicit
 * .ts extensions) so scripts/check-cards.mjs can run it under plain Node against the real API.
 */
import type { Hotspot } from '../../api/schemas.ts';
import { tierInfo, TIER_ORDER, type Tier } from '../../theme/tiers.ts';
import { probabilityBand } from './markers.ts';

export type TierFilter = 'ALL' | Tier;
export type SortKey = 'risk' | 'name';
export const FILTERS: TierFilter[] = ['ALL', 'RED', 'YELLOW', 'GREEN', 'LOW_RAIN'];

/** "chowk/underpass" -> "Chowk · Underpass"; "low-lying highway stretch" -> "Low-lying highway stretch". */
export function areaLabel(type: string): string {
  const t = type.trim();
  if (!t) return '';
  return t
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' · ');
}

/**
 * The first reason from the explanation sentence, for the card. The explanation looks like
 * "Rajiv Chowk - RED (39% estimated risk). Conditions lean toward elevated risk: the ground has already absorbed
 * 38mm of rain... It has flooded on 20 of the last 60 comparable rain days." The first sentence only restates the
 * tier, so the reason is the next one. Falls back to the whole text.
 */
export function firstReason(h: Pick<Hotspot, 'name' | 'tier' | 'explanation'>): string {
  if (h.tier === 'LOW_RAIN') return 'Not scored: under 10 mm of rain that day.';
  const sentences = h.explanation.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
  const rest = sentences.length > 1 && sentences[0].startsWith(h.name) ? sentences.slice(1) : sentences;
  return rest[0] ?? h.explanation;
}

export type CardModel = {
  id: string;
  name: string;
  area: string;
  tier: Tier;
  word: string;
  glyph: string;
  color: string;
  /** "about 35 to 40%" or "Not scored, under 10 mm rain" */
  risk: string;
  reason: string;
  reported: string | null;
};

export function cardModel(h: Hotspot, replay: boolean): CardModel {
  const t = tierInfo(h.tier);
  const band = probabilityBand(h.probability);
  return {
    id: h.id,
    name: h.name,
    area: areaLabel(h.type),
    tier: h.tier,
    word: t.word,
    glyph: t.glyph,
    color: t.color,
    risk: band ? `about ${band}` : 'Not scored, under 10 mm rain',
    reason: firstReason(h),
    reported: replay ? reportedText(h) : null,
  };
}

export function reportedText(h: Pick<Hotspot, 'reported_outcome' | 'tier'>): string {
  if (h.reported_outcome === 'flooded') return 'Flooded';
  if (h.reported_outcome === 'no_report') return 'No report';
  return h.tier === 'LOW_RAIN' ? 'Not recorded (rain under 10 mm)' : 'Not recorded';
}

export function countByTier(hotspots: readonly Pick<Hotspot, 'tier'>[]): Record<Tier, number> {
  const out: Record<Tier, number> = { RED: 0, YELLOW: 0, GREEN: 0, LOW_RAIN: 0 };
  hotspots.forEach((h) => (out[h.tier] += 1));
  return out;
}

/** Filter by tier chip, then sort: risk (RED first, then by probability, highest first) or name A to Z. */
export function filterAndSort<T extends Pick<Hotspot, 'tier' | 'probability' | 'name'>>(list: readonly T[], filter: TierFilter, sort: SortKey): T[] {
  const kept = filter === 'ALL' ? [...list] : list.filter((h) => h.tier === filter);
  return kept.sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || (b.probability ?? -1) - (a.probability ?? -1) || a.name.localeCompare(b.name),
  );
}

export function filterLabel(f: TierFilter): string {
  return f === 'ALL' ? 'All' : f === 'LOW_RAIN' ? 'LOW RAIN' : f;
}

/** Number of hotspots worth warning about (RED or YELLOW). */
export function atRiskCount(hotspots: readonly Pick<Hotspot, 'tier'>[]): number {
  return hotspots.filter((h) => h.tier === 'RED' || h.tier === 'YELLOW').length;
}

/** sink_depth_m > 0 means the point sits in a bowl below its surroundings; < 0 means it sits above them. */
export function sinkText(sinkDepthM: number): string {
  const v = Math.abs(sinkDepthM);
  if (v < 0.05) return 'level with the ground around it';
  return sinkDepthM > 0 ? `${v.toFixed(1)} m below the ground around it` : `${v.toFixed(1)} m above the ground around it`;
}

export type FactRow = { label: string; value: string };

export function conditionRows(c: Record<string, number | null> | null): FactRow[] | null {
  if (!c) return null;
  const mm = (v: number | null) => (v === null ? 'n/a' : `${v.toFixed(v < 10 ? 1 : 0)} mm`);
  return [
    { label: 'Rain over the day', value: mm(c.rain_24h) },
    { label: 'Heaviest hour', value: mm(c.rain_max_1h) },
    { label: 'Heaviest 3 hours', value: mm(c.rain_max_3h) },
    { label: 'Rain in the previous 3 days', value: mm(c.rain_prev_3d) },
    { label: 'Ground wetness (soil moisture)', value: c.soil_moisture_surface === null ? 'n/a' : `${Math.round(c.soil_moisture_surface * 100)}%` },
    { label: 'Rain so far this monsoon', value: mm(c.rain_season_cumulative) },
  ];
}

/** "18 flood reports, Sep 2022 to Sep 2026" */
export function historyText(h: { recorded_floods: number; first_date: string | null; last_date: string | null }): string {
  if (h.recorded_floods === 0) return 'No floods recorded here in our reports';
  // Fixed month names: toLocaleDateString gives "Sept" or "Sep" depending on the browser's locale data.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  const span = h.first_date && h.last_date ? `, ${fmt(h.first_date)} to ${fmt(h.last_date)}` : '';
  return `${h.recorded_floods} flood report${h.recorded_floods === 1 ? '' : 's'}${span}`;
}
