import { describe, expect, it } from 'vitest';

import type { HotspotEvent } from '@/api/schemas';
import { HI, phrases } from '@/lib/navPhrases';

import { makeDirections } from './fixtures';
import { arrivalClock, formatClock, formatDistance, formatKm, formatMinutes } from './format';
import { activeHotspot, guidanceAt } from './guidance';
import { angleDiff, bearing, circleRing, drivenLine, haversine, headingAt, positionAt, remainingLine, segmentAt, smoothAngle } from './geo';
import { ARRIVE_PROMPT_M, buildPrompts, PromptPlanner, STALE_M } from './prompts';
import { MAX_FRAME_S, RouteClock, Simulator } from './simulation';

const last = <T,>(a: readonly T[]): T => a[a.length - 1];
const D = makeDirections();
const clock = () => new RouteClock(D.steps, D.total_distance_m, D.total_duration_s);

describe('geo', () => {
  it('haversine and bearing agree with simple cases', () => {
    expect(haversine([28.45, 77.03], [28.46, 77.03])).toBeCloseTo(1111.95, 0);
    expect(bearing([28.45, 77.03], [28.46, 77.03])).toBeCloseTo(0, 3);
    expect(bearing([28.45, 77.03], [28.45, 77.04])).toBeCloseTo(90, 1);
    expect(bearing([28.45, 77.03], [28.44, 77.03])).toBeCloseTo(180, 3);
    expect(bearing([28.45, 77.03], [28.45, 77.02])).toBeCloseTo(270, 1);
  });
  it('angleDiff and smoothAngle take the short way round north', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(smoothAngle(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(smoothAngle(10, 350, 0.5)).toBeCloseTo(0, 6);
    expect(smoothAngle(90, 100, 1)).toBeCloseTo(100, 6);
    expect(smoothAngle(90, 100, 0)).toBeCloseTo(90, 6);
  });
  it('segmentAt finds the right segment and clamps', () => {
    const cum = [0, 10, 25, 25, 40];
    expect(segmentAt(cum, -5)).toBe(0);
    expect(segmentAt(cum, 5)).toBe(0);
    expect(segmentAt(cum, 10)).toBe(1);
    expect(segmentAt(cum, 30)).toBe(3);
    expect(segmentAt(cum, 999)).toBe(3);
  });
  it('positionAt interpolates along the line, stays on it and clamps to its ends', () => {
    const g = D.geometry;
    expect(positionAt(g, 0)).toMatchObject({ lat: g.coordinates[0][0], lon: g.coordinates[0][1] });
    const mid = positionAt(g, 375); // half way along the first 750 m segment
    expect(haversine([mid.lat, mid.lon], g.coordinates[0])).toBeCloseTo(375, 0);
    expect(mid.bearing).toBeCloseTo(90, 0);
    const end = positionAt(g, 1e9);
    expect(end.lat).toBe(last(g.coordinates)[0]);
    expect(positionAt(g, -5).index).toBe(0);
  });
  it('every position along the route is within a metre of the route line', () => {
    const g = D.geometry;
    const total = last(g.cumulative_m);
    for (let d = 0; d <= total; d += 17.3) {
      const p = positionAt(g, d);
      const walked = haversine(g.coordinates[p.index], [p.lat, p.lon]);
      const seg = g.cumulative_m[p.index + 1] - g.cumulative_m[p.index];
      expect(walked).toBeCloseTo(Math.min(seg, d - g.cumulative_m[p.index]), 0);
    }
  });
  it('headingAt follows the road, looks back at the very end, and ignores zero-length segments', () => {
    expect(headingAt(D.geometry, 100)).toBeCloseTo(90, 0);
    expect(headingAt(D.geometry, 2000)).toBeCloseTo(0, 0); // on Golf Course Road, heading north
    expect(headingAt(D.geometry, D.total_distance_m)).toBeCloseTo(180, 0); // at the end: the last road's direction
    const dup = { coordinates: [[28.45, 77.03], [28.45, 77.03], [28.46, 77.03]] as [number, number][], cumulative_m: [0, 0, 1111.9] };
    expect(positionAt(dup, 0).bearing).toBeCloseTo(0, 3);
  });
  it('drivenLine and remainingLine split the route at the car', () => {
    const d = 1000;
    const done = drivenLine(D.geometry, d);
    const left = remainingLine(D.geometry, d);
    expect(done[0]).toEqual(D.geometry.coordinates[0]);
    expect(last(done)).toEqual(left[0]);
    expect(last(left)).toEqual(last(D.geometry.coordinates));
  });
  it('circleRing is a closed ring of the right radius', () => {
    const ring = circleRing(28.45, 77.03, 500, 32);
    expect(ring[0]).toEqual(last(ring));
    for (const [lon, lat] of ring) expect(haversine([28.45, 77.03], [lat, lon])).toBeCloseTo(500, -1);
  });
});

describe('RouteClock and Simulator', () => {
  it('maps time and distance both ways, using each step\'s own speed', () => {
    const c = clock();
    expect(c.distanceAtTime(0)).toBe(0);
    expect(c.distanceAtTime(c.totalS)).toBeCloseTo(D.total_distance_m, 1);
    expect(c.totalS).toBeCloseTo(D.total_duration_s, 0);
    // the first 1500 m (Sohna Road) is driven at 20 m/s, the rest at 10 m/s
    expect(c.timeAtDistance(D.steps[1].start_m)).toBeCloseTo(D.steps[0].duration_s, 1);
    expect(c.distanceAtTime(10)).toBeCloseTo(200, 0);
    for (const d of [0, 120, 1500, 2222, 3000, D.total_distance_m]) expect(c.distanceAtTime(c.timeAtDistance(d))).toBeCloseTo(d, 3);
  });
  it('advances by real time times the multiplier, and never moves backwards', () => {
    const s = new Simulator(clock());
    s.multiplier = 10;
    s.tick(1000);
    expect(s.distance).toBe(0);
    s.tick(1050); // 50 ms real = 0.5 s of drive = 10 m at 20 m/s
    expect(s.distance).toBeCloseTo(10, 1);
    const before = s.distance;
    s.tick(1100);
    expect(s.distance).toBeGreaterThan(before);
  });
  it('pausing stops the car, and resuming continues without a jump', () => {
    const s = new Simulator(clock());
    s.multiplier = 5;
    s.tick(0);
    s.tick(100);
    const stopped = s.distance;
    s.paused = true;
    s.tick(5000);
    s.tick(9000);
    expect(s.distance).toBe(stopped);
    s.paused = false;
    s.tick(9016); // the first frame after resuming only advances by one frame
    expect(s.distance - stopped).toBeLessThan(5 * 0.02 * 20 + 0.01);
  });
  it('a hidden tab (a huge gap between frames) advances at most one capped frame, so the car never jumps', () => {
    const s = new Simulator(clock());
    s.multiplier = 20;
    s.tick(0);
    s.tick(10 * 60 * 1000); // ten minutes later
    expect(s.elapsedS).toBeCloseTo(MAX_FRAME_S * 20, 6);
    expect(s.distance).toBeLessThan(MAX_FRAME_S * 20 * 20 + 0.01);
  });
  it('finishes exactly at the end and stays there', () => {
    const c = clock();
    const s = new Simulator(c);
    s.multiplier = 20;
    let t = 0;
    s.tick(t);
    while (!s.finished) s.tick((t += 16));
    expect(s.distance).toBeCloseTo(D.total_distance_m, 1);
    s.tick(t + 16);
    expect(s.distance).toBeCloseTo(D.total_distance_m, 1);
    expect(s.speedMps).toBe(0);
  });
  it('a step with no duration falls back to the route average speed', () => {
    const steps = D.steps.map((st) => ({ ...st, duration_s: 0 }));
    const c = new RouteClock(steps, D.total_distance_m, D.total_duration_s);
    expect(c.totalS).toBeCloseTo(D.total_duration_s, 0);
  });
});

describe('guidanceAt', () => {
  const c = clock();
  it('points at the next manoeuvre and measures the distance to it', () => {
    const g = guidanceAt(1000, D, c);
    expect(g.next.index).toBe(1);
    expect(g.distanceToNextM).toBeCloseTo(D.steps[1].start_m - 1000, 1);
    expect(g.remainingM).toBeCloseTo(D.total_distance_m - 1000, 1);
    expect(g.remainingS).toBeGreaterThan(0);
  });
  it('moves on to the following manoeuvre once the first is passed', () => {
    expect(guidanceAt(D.steps[1].start_m + 5, D, c).next.index).toBe(2);
    expect(guidanceAt(D.steps[3].start_m + 5, D, c).next.maneuver).toBe('arrive');
    expect(guidanceAt(D.total_distance_m, D, c).next.maneuver).toBe('arrive');
  });
  it('"then ..." only when the manoeuvre after next is within 200 m of it, and never the arrival', () => {
    expect(guidanceAt(100, D, c).then).toBeNull(); // 1200 m to the next turn after that
    const close = makeDirections();
    // step 3 (Short Lane) is 300 m after step 2: not within 200 m
    expect(guidanceAt(D.steps[1].start_m + 1, close, c).then).toBeNull();
    const tight = makeDirections();
    tight.steps[3] = { ...tight.steps[3], start_m: tight.steps[2].start_m + 150 };
    expect(guidanceAt(tight.steps[1].start_m + 1, tight, c).then?.index).toBe(3);
    expect(guidanceAt(D.steps[3].start_m - 10, D, c).then).toBeNull(); // after the last turn comes the arrival
  });
  it('remaining time shrinks as the car moves', () => {
    expect(guidanceAt(2000, D, c).remainingS).toBeLessThan(guidanceAt(500, D, c).remainingS);
    expect(guidanceAt(D.total_distance_m, D, c).remainingS).toBe(0);
  });
});

describe('activeHotspot', () => {
  const ev = D.hotspot_events[0];
  it('shows only between where the car comes within 1 km and the end of the window', () => {
    expect(activeHotspot(ev.approach_distance_m - 1, D.hotspot_events)).toBeNull();
    expect(activeHotspot(ev.approach_distance_m, D.hotspot_events)).toBe(ev);
    expect(activeHotspot(ev.exit_distance_m, D.hotspot_events)).toBe(ev);
    expect(activeHotspot(ev.exit_distance_m + 1, D.hotspot_events)).toBeNull();
  });
  it('an avoided hotspot that is never within 1 km still gets a window around where it is closest', () => {
    const far: HotspotEvent = { ...ev, within_radius: false, approach_distance_m: 500, exit_distance_m: 500, closest_distance_along_m: 500 };
    expect(activeHotspot(700, [far])).toBe(far);
    expect(activeHotspot(1000, [far])).toBeNull();
  });
  it('ignores hotspots the route neither avoids nor goes through ("passes near")', () => {
    const near: HotspotEvent = { ...ev, avoided: false, passes_through: false };
    expect(activeHotspot(ev.approach_distance_m + 10, [near])).toBeNull();
  });
});

describe('phrases', () => {
  const [depart, left, right, shortLane] = D.steps;
  it('English prompts follow the spec examples', () => {
    const say = phrases('en');
    expect(say.inMetres(left, 500)).toBe('In 500 metres, turn left onto Golf Course Road.');
    expect(say.inMetres(right, 150)).toBe('In 150 metres, turn right.');
    expect(say.now(left)).toBe('Turn left now.');
    expect(say.now(shortLane)).toBe('Turn right now.');
    expect(say.depart(depart)).toBe('Head east on Sohna Road.');
    expect(say.arrive('Cyber Hub')).toBe('You have arrived at Cyber Hub.');
    expect(say.arrive('')).toBe('You have arrived at your destination.');
  });
  it('a merged pair keeps both parts in the distance prompt but announces only the first at the manoeuvre', () => {
    const merged = { ...left, instruction_en: 'Turn left onto Beta, then turn right onto Gamma' };
    expect(phrases('en').inMetres(merged, 150)).toBe('In 150 metres, turn left onto Beta, then turn right onto Gamma.');
    expect(phrases('en').now(merged)).toBe('Turn left now.');
  });
  it('a change of road in the same direction says "Continue onto X", not "Continue now"', () => {
    const c = { ...left, maneuver: 'continue' as const, modifier: 'straight' as const, instruction_en: 'Continue onto Sohna Road' };
    expect(phrases('en').now(c)).toBe('Continue onto Sohna Road.');
    expect(phrases('en').now({ ...c, instruction_en: 'Continue onto Sohna Road, then continue onto Shubhash Chowk Underpass' })).toBe('Continue onto Sohna Road.');
    expect(phrases('hi').now(c)).toBe('सीधे चलते रहें।');
  });
  it('roundabouts say the exit, without "now"', () => {
    const r = { ...left, maneuver: 'roundabout' as const, modifier: 'straight' as const, exit_number: 2, instruction_en: 'At the roundabout, take the second exit onto East Road' };
    expect(phrases('en').inMetres(r, 150)).toBe('In 150 metres, at the roundabout, take the second exit onto East Road.');
    expect(phrases('en').now(r)).toBe('At the roundabout, take the second exit.');
    expect(phrases('hi').now(r)).toBe(`${HI.roundabout('दूसरा')}।`);
  });
  it('hotspot lines are honest: avoided says "keeps you clear", through says no other road avoids it', () => {
    const ev = D.hotspot_events[0];
    expect(phrases('en').hotspot(ev)).toBe('Rajiv Chowk, rated RED, is to your right. Your route keeps you clear of it.');
    expect(phrases('en').hotspot({ ...ev, side: 'left' })).toContain('to your left');
    expect(phrases('en').hotspot({ ...ev, side: 'on_route', avoided: false, passes_through: true })).toBe(
      'You are approaching Rajiv Chowk, rated RED. No other road avoids it.');
    expect(phrases('en').hotspot({ ...ev, avoided: false, passes_through: false })).toBeNull();
  });
  it('Hindi templates cover every manoeuvre and the street, the side and the hotspot', () => {
    const say = phrases('hi');
    expect(say.now(left)).toBe('अब बाएं मुड़ें।');
    expect(say.now(right)).toBe('अब दाएं मुड़ें।');
    expect(say.inMetres(left, 500)).toBe('500 मीटर बाद, Golf Course Road पर बाएं मुड़ें।');
    expect(say.inMetres(right, 150)).toBe('150 मीटर बाद, दाएं मुड़ें।');
    expect(say.depart({ ...depart, bearing_after: 0, street: null })).toBe('उत्तर की ओर चलें।');
    expect(say.depart(depart)).toBe('Sohna Road पर पूर्व की ओर चलें।');
    expect(say.arrive('Cyber Hub')).toBe('आप Cyber Hub पहुँच गए हैं।');
    expect(say.hotspot(D.hotspot_events[0])).toContain('रेड श्रेणी');
    expect(say.hotspot(D.hotspot_events[0])).toContain('दाएं');
    for (const m of ['slight', 'sharp', 'uturn', 'continue'] as const) {
      expect(say.now({ ...left, maneuver: m })).toMatch(/[ऀ-ॿ]/);
      expect(say.now({ ...left, maneuver: m })).not.toMatch(/[A-Za-z]/);
    }
    expect(say.now({ ...left, maneuver: 'slight', modifier: 'right' })).toContain('दाएं');
  });
  it('Hindi never speaks a street name for a merged pair (the street belongs to the second manoeuvre)', () => {
    const merged = { ...left, instruction_en: 'Turn left, then turn right onto Gamma', street: 'Gamma' };
    expect(phrases('hi').inMetres(merged, 150)).toBe('150 मीटर बाद, बाएं मुड़ें।');
  });
});

describe('prompts', () => {
  const opts = { language: 'en' as const, destinationName: 'Medanta', startText: 'Summary. Head east on Sohna Road.' };
  const prompts = buildPrompts(D, opts);
  const byId = (id: string) => prompts.find((p) => p.id === id);

  it('has the start line, each manoeuvre, the hotspot once and the arrival', () => {
    expect(byId('start')).toMatchObject({ at: 0, text: opts.startText });
    expect(prompts.filter((p) => p.kind === 'hotspot')).toHaveLength(1);
    expect(prompts.filter((p) => p.kind === 'now').map((p) => p.id)).toEqual(['now-1', 'now-2', 'now-3']);
    expect(byId('arrive')).toMatchObject({ at: D.total_distance_m - ARRIVE_PROMPT_M, text: 'You have arrived at Medanta.' });
    expect(new Set(prompts.map((p) => p.id)).size).toBe(prompts.length);
  });
  it('500 m prompts only on roads over 800 m, 150 m prompts only on roads over 300 m', () => {
    // road before step 1 is 1500 m (>=800): both; before step 2 is 1200 m: both; before step 3 is 900 m: both
    expect(byId('far-1')?.at).toBeCloseTo(D.steps[1].start_m - 500, 1);
    expect(byId('near-1')?.at).toBeCloseTo(D.steps[1].start_m - 150, 1);
    const short = makeDirections();
    short.steps[1] = { ...short.steps[1], start_m: 700 }; // the road before it is only 700 m
    short.steps[0] = { ...short.steps[0], distance_m: 700 };
    const p = buildPrompts(short, opts);
    expect(p.find((x) => x.id === 'far-1')).toBeUndefined();
    expect(p.find((x) => x.id === 'near-1')).toBeDefined();
    short.steps[0] = { ...short.steps[0], distance_m: 250 };
    expect(buildPrompts(short, opts).find((x) => x.id === 'near-1')).toBeUndefined();
    expect(buildPrompts(short, opts).find((x) => x.id === 'now-1')).toBeDefined();
  });
  it('are in order along the route', () => {
    expect(prompts.map((p) => p.at)).toEqual([...prompts.map((p) => p.at)].sort((a, b) => a - b));
  });

  it('the planner fires each prompt once, in order', () => {
    const planner = new PromptPlanner(prompts);
    const spoken: string[] = [];
    for (let d = 0; d <= D.total_distance_m + 1; d += 2) {
      const p = planner.due(d, 1);
      if (p) spoken.push(p.id);
    }
    expect(spoken).toEqual(prompts.map((p) => p.id));
    expect(planner.due(D.total_distance_m + 50, 1)).toBeNull();
  });
  it('at high speed the 500 m and 150 m prompts are skipped, the "now" prompts, hotspot and arrival still play', () => {
    const planner = new PromptPlanner(prompts);
    const spoken: string[] = [];
    for (let d = 0; d <= D.total_distance_m + 1; d += 2) {
      const p = planner.due(d, 10);
      if (p) spoken.push(p.id);
    }
    expect(spoken.some((id) => id.startsWith('far') || id.startsWith('near'))).toBe(false);
    expect(spoken).toEqual(prompts.filter((p) => p.kind !== 'far' && p.kind !== 'near').map((p) => p.id));
  });
  it('when several are due in one frame only the most important is spoken (no queue)', () => {
    const planner = new PromptPlanner(prompts);
    planner.due(0, 1);
    const p = planner.due(D.steps[1].start_m + 1, 1); // far, near and now of step 1 all passed in one jump
    expect(p?.id).toBe('now-1');
    expect(planner.due(D.steps[1].start_m + 2, 1)).toBeNull();
  });
  it('a prompt more than 60 m behind the car is dropped, not spoken late', () => {
    const planner = new PromptPlanner(prompts);
    planner.due(0, 1);
    expect(planner.due(D.steps[1].start_m + STALE_M + 100, 1)?.kind).not.toBe('now');
  });
  it('Hindi prompts use the Hindi templates only', () => {
    const hi = buildPrompts(D, { language: 'hi', destinationName: 'Medanta', startText: 'x' });
    expect(hi.find((p) => p.id === 'now-1')?.text).toBe('अब बाएं मुड़ें।');
    expect(hi.find((p) => p.id === 'arrive')?.text).toBe('आप Medanta पहुँच गए हैं।');
  });
});

describe('format', () => {
  it('distances read like a satnav', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(7)).toBe('5 m');
    expect(formatDistance(48)).toBe('50 m');
    expect(formatDistance(304)).toBe('300 m');
    expect(formatDistance(996)).toBe('1000 m');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(12_400)).toBe('12 km');
    expect(formatKm(3720)).toBe('3.7 km');
    expect(formatKm(-5)).toBe('0.0 km');
  });
  it('minutes and the arrival clock', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(20)).toBe('1 min');
    expect(formatMinutes(530)).toBe('9 min');
    const t = new Date(2026, 7, 7, 18, 30, 0);
    expect(arrivalClock(t, 12 * 60)).toBe(formatClock(new Date(2026, 7, 7, 18, 42, 0)));
    expect(formatClock(new Date(2026, 7, 7, 18, 42, 0))).toMatch(/^6:42\s?pm$/);
  });
});
