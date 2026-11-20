/**
 * Pure helpers for the Home map: no React, no Leaflet, no DOM. Imports only the tier helper and types, so
 * `scripts/check-markers.mjs` can run them under plain Node against the real API.
 */
import type { Hotspot } from '../../api/schemas.ts';
import { tierInfo, TIER_ORDER, type Tier } from '../../theme/tiers.ts';

export type MarkerSpec = {
  id: string;
  /** Text shown ON the marker: glyph + word, so colour is never the only signal. */
  text: string;
  glyph: string;
  word: string;
  color: string;
  tier: Tier;
  /** Screen-reader / tooltip label, e.g. "Rajiv Chowk: RED: avoid, about 40 to 45% estimated risk". */
  ariaLabel: string;
};

/** Bucket of width 5 percentage points, e.g. 0.389 -> "35 to 40%". null for unscored hotspots. */
export function probabilityBand(p: number | null): string | null {
  if (p === null) return null;
  const pct = Math.min(Math.max(p * 100, 0), 100);
  if (pct < 1) return 'under 1%';
  const lo = Math.min(Math.floor(pct / 5) * 5, 95);
  return `${lo} to ${lo + 5}%`;
}

export function markerSpec(h: Hotspot): MarkerSpec {
  const t = tierInfo(h.tier);
  const band = probabilityBand(h.probability);
  return {
    id: h.id,
    text: `${t.glyph} ${t.word}`,
    glyph: t.glyph,
    word: t.word,
    color: t.color,
    tier: h.tier,
    ariaLabel: `${h.name}: ${t.label}${band ? `, about ${band} estimated risk` : ''}`,
  };
}

/** RED first, then YELLOW, GREEN, LOW_RAIN; within a tier, highest probability first, then name. */
export function sortHotspots<T extends Pick<Hotspot, 'tier' | 'probability' | 'name'>>(list: readonly T[]): T[] {
  return [...list].sort(
    (a, b) =>
      TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
      (b.probability ?? -1) - (a.probability ?? -1) ||
      a.name.localeCompare(b.name),
  );
}

export function reportedOutcomeText(h: Pick<Hotspot, 'reported_outcome' | 'tier'>): string {
  if (h.reported_outcome === 'flooded') return 'Flooded (reported)';
  if (h.reported_outcome === 'no_report') return 'No flood reported';
  return h.tier === 'LOW_RAIN' ? 'Not recorded (rain was under 10 mm)' : 'Not recorded';
}
