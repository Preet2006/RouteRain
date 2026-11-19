/**
 * Tier colour + word + glyph, used everywhere a risk tier is shown.
 * Colour is never the only signal (PLAN.md colour-blind rule): every tier also has a
 * distinct word and a distinct glyph shape.
 */
import { colors } from './tokens';

export type Tier = 'GREEN' | 'YELLOW' | 'RED' | 'NOT_SCORED';

export type TierInfo = {
  tier: Tier;
  color: string;
  /** short word for markers and chips */
  word: string;
  /** full label for sheets and speech, e.g. "RED: avoid" */
  label: string;
  glyph: string;
};

const TIERS: Record<Tier, TierInfo> = {
  GREEN: { tier: 'GREEN', color: colors.good, word: 'GREEN', label: 'GREEN: proceed normally', glyph: '✓' },
  YELLOW: { tier: 'YELLOW', color: colors.warn, word: 'YELLOW', label: 'YELLOW: allow extra time', glyph: '!' },
  RED: { tier: 'RED', color: colors.danger, word: 'RED', label: 'RED: avoid', glyph: '✕' },
  NOT_SCORED: {
    tier: 'NOT_SCORED',
    color: colors.neutral,
    word: 'LOW RAIN',
    label: 'LOW RAIN: not scored (under 10 mm)',
    glyph: '–',
  },
};

export function tierInfo(tier: Tier): TierInfo {
  return TIERS[tier];
}
