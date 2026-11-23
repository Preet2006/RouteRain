// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Hotspot } from '@/api/schemas';

import { HotspotMap, splitCore } from './HotspotMap';

const spot = (n: number, tier: Hotspot['tier'], p: number | null): Hotspot => ({
  id: `H${String(n).padStart(2, '0')}`, name: `Spot ${n}`, lat: 28.4 + n / 100, lon: 77 + n / 100,
  tier, probability: p, explanation: `Spot ${n} - ${tier}`, reported_outcome: null,
});
const TWELVE: Hotspot[] = [
  spot(1, 'RED', 0.4), spot(2, 'RED', 0.34), spot(3, 'YELLOW', 0.2), spot(4, 'YELLOW', 0.12), spot(5, 'GREEN', 0.04),
  spot(6, 'GREEN', 0.03), spot(7, 'GREEN', 0.02), spot(8, 'GREEN', 0.02), spot(9, 'GREEN', 0.01), spot(10, 'GREEN', 0.01),
  spot(11, 'LOW_RAIN', null), spot(12, 'LOW_RAIN', null),
];

// jsdom has no layout: give elements a size so Leaflet can compute positions.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 900 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 900 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON: () => ({}) });

afterEach(cleanup);

describe('HotspotMap', () => {
  it('draws one marker per hotspot, each with a text label (tier word), not colour alone', () => {
    const { container } = render(<HotspotMap hotspots={TWELVE} selectedId={null} onSelect={() => {}} />);
    const markers = [...container.querySelectorAll('.rr-marker')];
    expect(markers).toHaveLength(12);
    const words = markers.map((m) => m.textContent!.replace(/^\S+\s/, '').trim());
    expect(words.filter((w) => w === 'RED')).toHaveLength(2);
    expect(words.filter((w) => w === 'YELLOW')).toHaveLength(2);
    expect(words.filter((w) => w === 'GREEN')).toHaveLength(6);
    expect(words.filter((w) => w === 'LOW RAIN')).toHaveLength(2);
    expect(markers.every((m) => /\S+ \S/.test(m.textContent!))).toBe(true); // glyph + word
  });

  it('gives LOW RAIN markers the grey class and every marker an accessible name', () => {
    const { container } = render(<HotspotMap hotspots={TWELVE} selectedId={null} onSelect={() => {}} />);
    expect(container.querySelectorAll('.rr-marker.LOW_RAIN')).toHaveLength(2);
    const icons = [...container.querySelectorAll<HTMLElement>('.leaflet-marker-icon')];
    expect(icons).toHaveLength(12);
    expect(icons.every((i) => (i.getAttribute('title') ?? '').includes(':'))).toBe(true);
    expect(icons[0].getAttribute('title')).toBe('Spot 1: RED: avoid, about 40 to 45% estimated risk');
    expect(icons[10].getAttribute('title')).toBe('Spot 11: LOW RAIN: not scored (under 10 mm)');
  });

  it('marks the selected hotspot (marker clicks need real layout, so selection is tested via the list in home.test)', () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(<HotspotMap hotspots={TWELVE} selectedId={null} onSelect={onSelect} />);
    expect(container.querySelectorAll('.rr-marker.selected')).toHaveLength(0);
    rerender(<HotspotMap hotspots={TWELVE} selectedId="H03" onSelect={onSelect} />);
    expect(container.querySelectorAll('.rr-marker.selected')).toHaveLength(1);
  });

  it('renders an empty map (no markers) while hotspots are loading', () => {
    const { container, getByRole } = render(<HotspotMap hotspots={[]} selectedId={null} onSelect={() => {}} loading />);
    expect(container.querySelectorAll('.rr-marker')).toHaveLength(0);
    expect(getByRole('status').textContent).toMatch(/loading hotspots/i);
  });
});


describe('far-away hotspots', () => {
  const far = { ...spot(99, 'RED', 0.5), name: 'Bilaspur Chowk', lat: 28.2886, lon: 76.8602 };
  const withFar = [...TWELVE.slice(0, 11), far];

  it('splitCore separates a hotspot ~30 km from the rest, and keeps a tight group whole', () => {
    expect(splitCore(withFar).outside.map((h) => h.name)).toEqual(['Bilaspur Chowk']);
    expect(splitCore(withFar).core).toHaveLength(11);
    expect(splitCore(TWELVE).outside).toEqual([]);
    expect(splitCore([far]).outside).toEqual([]); // fewer than 3: nothing to compare against
  });

  it('still draws a marker for it, and tells the user it is outside the view with a Show all button', () => {
    const { container, getByRole } = render(<HotspotMap hotspots={withFar} selectedId={null} onSelect={() => {}} />);
    expect(container.querySelectorAll('.rr-marker')).toHaveLength(12); // nothing is dropped
    const note = getByRole('status');
    expect(note.textContent).toMatch(/1 hotspot is outside this view: Bilaspur Chowk \(RED\)/);
    expect(note.querySelector('button')!.textContent).toBe('Show all');
  });

  it('shows no such note when everything is close together', () => {
    const { container } = render(<HotspotMap hotspots={TWELVE} selectedId={null} onSelect={() => {}} />);
    expect(container.querySelector('.rr-outside')).toBeNull();
  });
});
