// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Hotspot } from '@/api/schemas';

import { DETAIL_ZOOM, HotspotDetailMap } from './HotspotDetailMap';

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 900 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 900 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

const spot = (tier: Hotspot['tier']): Hotspot => ({
  id: 'H02', name: 'Rajiv Chowk', lat: 28.4474509, lon: 77.0327407, tier, probability: tier === 'LOW_RAIN' ? null : 0.39,
  explanation: '', reported_outcome: null, type: 'chowk/underpass',
});

afterEach(cleanup);

describe('HotspotDetailMap', () => {
  it('draws one risk-zone circle in the tier colour and a text-labelled marker', () => {
    const { container, getByRole } = render(<HotspotDetailMap hotspot={spot('RED')} bufferM={500} />);
    const circles = container.querySelectorAll('path.leaflet-interactive');
    expect(circles).toHaveLength(1);
    expect(circles[0].getAttribute('stroke')).toBe('#ff667c');
    expect(circles[0].getAttribute('stroke-dasharray')).toBe('6 6');
    const marker = container.querySelector('.rr-marker');
    expect(marker!.textContent).toMatch(/RED$/);
    expect(container.querySelector('.leaflet-marker-icon')!.getAttribute('title')).toBe('Rajiv Chowk: RED: avoid, about 35 to 40% estimated risk');
    expect(getByRole('note').textContent).toMatch(/500 m zone.*RED/);
  });

  it('is a street-level view', () => {
    expect(DETAIL_ZOOM).toBeGreaterThanOrEqual(16);
  });

  it('a 300 m zone for YELLOW, and the map is labelled for screen readers', () => {
    const { container, getByRole } = render(<HotspotDetailMap hotspot={spot('YELLOW')} bufferM={300} />);
    expect(container.querySelector('path.leaflet-interactive')!.getAttribute('stroke')).toBe('#ffca68');
    expect(getByRole('note').textContent).toMatch(/300 m zone.*YELLOW/);
    expect(container.querySelector('[data-testid="detail-map"]')!.getAttribute('aria-label')).toBe('Street map around Rajiv Chowk');
    expect(container.querySelector('[data-testid="detail-map"]')!.getAttribute('role')).toBe('region');
  });

  it('LOW RAIN gets a grey marker with its own word and no percentage in its name', () => {
    const { container } = render(<HotspotDetailMap hotspot={spot('LOW_RAIN')} bufferM={300} />);
    expect(container.querySelector('.rr-marker.LOW_RAIN')!.textContent).toMatch(/LOW RAIN$/);
    expect(container.querySelector('.leaflet-marker-icon')!.getAttribute('title')).not.toMatch(/%/);
  });
});
