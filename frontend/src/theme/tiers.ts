/**
 * Tier colour + word + glyph, used wherever a risk tier is shown.
 * Colour is never the only signal (PLAN.md colour-blind rule): every tier also has a distinct
 * word and a distinct glyph shape.
 */
import { colors } from './tokens';

export type Tier = 'RED' | 'YELLOW' | 'GREEN' | 'LOW_RAIN';

export type TierInfo = {
  tier: Tier;
  color: string;
  /** short word for markers and chips */
  word: string;
  /** full label for panels and speech */
  label: string;
  glyph: string;
};

const TIERS: Record<Tier, TierInfo> = {
  RED: { tier: 'RED', color: colors.red, word: 'RED', label: 'RED: avoid', glyph: '✕' },
  YELLOW: { tier: 'YELLOW', color: colors.yellow, word: 'YELLOW', label: 'YELLOW: allow extra time', glyph: '!' },
  GREEN: { tier: 'GREEN', color: colors.green, word: 'GREEN', label: 'GREEN: proceed normally', glyph: '✓' },
  LOW_RAIN: {
    tier: 'LOW_RAIN',
    color: colors.neutral,
    word: 'LOW RAIN',
    label: 'LOW RAIN: not scored (under 10 mm)',
    glyph: '–',
  },
};

export const TIER_ORDER: Tier[] = ['RED', 'YELLOW', 'GREEN', 'LOW_RAIN'];

export function tierInfo(tier: Tier): TierInfo {
  return TIERS[tier];
}
