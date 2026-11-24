// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Hotspot } from '@/api/schemas';

import { PickMap } from './PickMap';

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 900 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 900 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

const spot = (n: number, tier: Hotspot['tier'], p: number | null): Hotspot => ({
  id: `H0${n}`, name: `Spot ${n}`, lat: 28.4 + n / 100, lon: 77 + n / 100, tier, probability: p, explanation: '', reported_outcome: null, type: 'chowk',
});
const SPOTS = [spot(1, 'RED', 0.4), spot(2, 'YELLOW', 0.2), spot(3, 'GREEN', 0.03), spot(4, 'LOW_RAIN', null)];
const props = { from: null, to: null, picking: null, onPick: () => {} } as const;

afterEach(cleanup);

describe('hotspot dots on the plan map', () => {
  it('draws one small dot per hotspot, coloured by tier, with no long text on the map itself', () => {
    const { container } = render(<PickMap {...props} hotspots={SPOTS} />);
    const dots = [...container.querySelectorAll('.rr-dot')];
    expect(dots.map((d) => d.className.replace('rr-dot ', ''))).toEqual(['RED', 'YELLOW', 'GREEN', 'LOW_RAIN']);
    expect(dots.every((d) => d.textContent === '')).toBe(true);
  });

  it('every dot has an accessible name with its tier in words, and can be focused with the keyboard', () => {
    const { container } = render(<PickMap {...props} hotspots={SPOTS} />);
    const icons = [...container.querySelectorAll<HTMLElement>('.leaflet-marker-icon')].filter((i) => i.querySelector('.rr-dot'));
    expect(icons).toHaveLength(4);
    expect(icons.map((i) => i.getAttribute('title'))).toEqual([
      'Spot 1: RED: avoid, about 40 to 45% estimated risk',
      'Spot 2: YELLOW: allow extra time, about 20 to 25% estimated risk',
      'Spot 3: GREEN: proceed normally, about 0 to 5% estimated risk',
      'Spot 4: LOW RAIN: not scored (under 10 mm)',
    ]);
    expect(icons.every((i) => i.getAttribute('tabindex') === '0')).toBe(true);
  });

  it('the name and tier word appear on keyboard focus (and go away on blur)', () => {
    const { container } = render(<PickMap {...props} hotspots={SPOTS} />);
    const icon = [...container.querySelectorAll<HTMLElement>('.leaflet-marker-icon')].find((i) => i.querySelector('.rr-dot.RED'))!;
    expect(container.querySelector('.leaflet-tooltip')).toBeNull();
    fireEvent.focus(icon);
    expect(container.querySelector('.leaflet-tooltip')!.textContent).toBe('Spot 1: RED');
    fireEvent.blur(icon);
    expect(container.querySelector('.leaflet-tooltip')).toBeNull();
  });

  it('draws no dots when none are passed (the toggle is off or the data is unavailable)', () => {
    const { container } = render(<PickMap {...props} hotspots={[]} />);
    expect(container.querySelectorAll('.rr-dot')).toHaveLength(0);
    const { container: c2 } = render(<PickMap {...props} />);
    expect(c2.querySelectorAll('.rr-dot')).toHaveLength(0);
  });
});
