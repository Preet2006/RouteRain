import { describe, expect, it } from 'vitest';

import type { Hotspot } from '../../api/schemas';
import {
  areaLabel, atRiskCount, cardModel, conditionRows, countByTier, filterAndSort, firstReason, historyText, sinkText,
} from './model';

const EXPL = 'Rajiv Chowk - RED (39% estimated risk). Conditions lean toward elevated risk: the ground has already absorbed 38mm of rain over the preceding 3 days. It has flooded on 20 of the last 60 comparable rain days at this location.';
const h = (over: Partial<Hotspot>): Hotspot => ({
  id: 'H02', name: 'Rajiv Chowk', lat: 28.44, lon: 77.03, tier: 'RED', probability: 0.3889, explanation: EXPL, reported_outcome: 'flooded', type: 'chowk/underpass', ...over,
});

describe('areaLabel', () => {
  it('capitalises each part and joins with a dot', () => {
    expect(areaLabel('chowk/underpass')).toBe('Chowk · Underpass');
    expect(areaLabel('low-lying highway stretch')).toBe('Low-lying highway stretch');
    expect(areaLabel('road near hospital')).toBe('Road near hospital');
    expect(areaLabel('')).toBe('');
    expect(areaLabel('  / ')).toBe('');
  });
});

describe('firstReason', () => {
  it('skips the sentence that only restates the tier and takes the first real reason', () => {
    expect(firstReason(h({}))).toBe('Conditions lean toward elevated risk: the ground has already absorbed 38mm of rain over the preceding 3 days.');
  });
  it('falls back to the whole text when there is only one sentence', () => {
    expect(firstReason(h({ explanation: 'Just one sentence.' }))).toBe('Just one sentence.');
  });
  it('says LOW RAIN hotspots are not scored', () => {
    expect(firstReason(h({ tier: 'LOW_RAIN', probability: null }))).toBe('Not scored: under 10 mm of rain that day.');
  });
});

describe('cardModel', () => {
  it('builds the card text from the API item', () => {
    expect(cardModel(h({}), true)).toEqual({
      id: 'H02', name: 'Rajiv Chowk', area: 'Chowk · Underpass', tier: 'RED', word: 'RED', glyph: '✕', color: '#ff667c',
      risk: 'about 35 to 40%', reason: expect.stringContaining('Conditions lean toward'), reported: 'Flooded',
    });
  });
  it('shows the reported outcome only in replay, never in live', () => {
    expect(cardModel(h({}), false).reported).toBeNull();
    expect(cardModel(h({ reported_outcome: 'no_report' }), true).reported).toBe('No report');
  });
  it('LOW RAIN: no percentage, an explicit not-scored line', () => {
    const c = cardModel(h({ tier: 'LOW_RAIN', probability: null, reported_outcome: null }), true);
    expect(c.risk).toBe('Not scored, under 10 mm rain');
    expect(c.risk).not.toMatch(/%/);
    expect(c.reported).toBe('Not recorded (rain under 10 mm)');
    expect(c.word).toBe('LOW RAIN');
  });
});

describe('filter and sort', () => {
  const list = [
    h({ id: 'a', name: 'Beta', tier: 'GREEN', probability: 0.03 }),
    h({ id: 'b', name: 'Alpha', tier: 'RED', probability: 0.4 }),
    h({ id: 'c', name: 'Gamma', tier: 'YELLOW', probability: 0.2 }),
    h({ id: 'd', name: 'Delta', tier: 'RED', probability: 0.8 }),
    h({ id: 'e', name: 'Eps', tier: 'LOW_RAIN', probability: null }),
  ];
  it('sorts by risk: RED first, then by probability, LOW RAIN last', () => {
    expect(filterAndSort(list, 'ALL', 'risk').map((x) => x.id)).toEqual(['d', 'b', 'c', 'a', 'e']);
  });
  it('sorts by name A to Z', () => {
    expect(filterAndSort(list, 'ALL', 'name').map((x) => x.name)).toEqual(['Alpha', 'Beta', 'Delta', 'Eps', 'Gamma']);
  });
  it('filters by tier and still sorts', () => {
    expect(filterAndSort(list, 'RED', 'risk').map((x) => x.id)).toEqual(['d', 'b']);
    expect(filterAndSort(list, 'RED', 'name').map((x) => x.id)).toEqual(['b', 'd']);
    expect(filterAndSort(list, 'LOW_RAIN', 'risk').map((x) => x.id)).toEqual(['e']);
  });
  it('does not change the original list', () => {
    const copy = [...list];
    filterAndSort(list, 'ALL', 'name');
    expect(list).toEqual(copy);
  });
  it('counts per tier and at-risk', () => {
    expect(countByTier(list)).toEqual({ RED: 2, YELLOW: 1, GREEN: 1, LOW_RAIN: 1 });
    expect(atRiskCount(list)).toBe(3);
  });
});

describe('plain-language facts', () => {
  it('describes the ground honestly in both directions', () => {
    expect(sinkText(2.06)).toBe('2.1 m below the ground around it');
    expect(sinkText(-0.7)).toBe('0.7 m above the ground around it');
    expect(sinkText(0.02)).toBe('level with the ground around it');
  });
  it('turns conditions into labelled rows, soil moisture as a percentage', () => {
    const rows = conditionRows({ rain_24h: 48.2, rain_max_1h: 21, rain_max_3h: 33.5, rain_prev_3d: 8.04, soil_moisture_surface: 0.424, rain_season_cumulative: 611.4 })!;
    expect(rows.map((r) => r.value)).toEqual(['48 mm', '21 mm', '34 mm', '8.0 mm', '42%', '611 mm']);
    expect(rows[0].label).toBe('Rain over the day');
  });
  it('null conditions stay null (not scored), and missing numbers read n/a', () => {
    expect(conditionRows(null)).toBeNull();
    expect(conditionRows({ rain_24h: null, rain_max_1h: null, rain_max_3h: null, rain_prev_3d: null, soil_moisture_surface: null, rain_season_cumulative: null })!.every((r) => r.value === 'n/a')).toBe(true);
  });
  it('words the flood history', () => {
    expect(historyText({ recorded_floods: 18, first_date: '2022-09-22', last_date: '2026-09-05' })).toBe('18 flood reports, Sep 2022 to Sep 2026');
    expect(historyText({ recorded_floods: 1, first_date: '2024-07-27', last_date: '2024-07-27' })).toMatch(/^1 flood report,/);
    expect(historyText({ recorded_floods: 0, first_date: null, last_date: null })).toMatch(/no floods recorded/i);
  });
});
