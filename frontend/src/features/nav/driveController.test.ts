import { describe, expect, it, vi } from 'vitest';

import type { SpeakResult } from '@/lib/speech';

import { DriveController, type DriveDeps, type Frame, type Hud } from './driveController';
import { makeDirections } from './fixtures';
import { haversine, positionAt } from './geo';
import { buildPrompts } from './prompts';

const D = makeDirections();
const START = 'Summary. Head east on Sohna Road.';

/** Drives the controller with a manual 60 fps clock. */
function setup(over: Partial<DriveDeps> = {}) {
  const frames: Frame[] = [];
  const huds: Hud[] = [];
  const spoken: { text: string; atM: number }[] = [];
  let atM = 0;
  let pending: ((t: number) => void) | null = null;
  const deps: DriveDeps = {
    directions: D,
    language: 'en',
    destinationName: 'Medanta',
    startText: START,
    multiplier: 10,
    autoStart: true,
    holdForStartLine: false,
    speak: vi.fn(async (text: string): Promise<SpeakResult> => {
      spoken.push({ text, atM });
      return 'ended';
    }),
    stopSpeech: vi.fn(),
    onFrame: (f) => {
      atM = f.distanceM;
      frames.push(f);
    },
    onHud: (h) => huds.push(h),
    onArrive: vi.fn(),
    raf: (cb) => {
      pending = cb;
      return 1;
    },
    caf: () => {
      pending = null;
    },
    ...over,
  };
  const ctl = new DriveController(deps, buildPrompts(D, { language: deps.language, destinationName: 'Medanta', startText: START }));
  let t = 0;
  const run = (maxFrames = 1_000_000) => {
    for (let i = 0; i < maxFrames && pending; i++) {
      const cb = pending;
      pending = null;
      t += 16;
      cb(t);
    }
  };
  return { ctl, deps, frames, huds, spoken, run, hasPending: () => pending !== null, now: () => t };
}

describe('a full simulated drive', () => {
  for (const multiplier of [10, 5]) {
    it(`at ${multiplier}x: every manoeuvre is spoken once, in order, then the arrival, and the car stays on the line`, async () => {
      const s = setup({ multiplier });
      s.ctl.start();
      s.run();
      expect(s.deps.onArrive).toHaveBeenCalledTimes(1);
      const says = s.spoken.map((x) => x.text);
      expect(says[0]).toBe(START);
      expect(says[says.length - 1]).toBe('You have arrived at Medanta.');
      const turns = says.filter((t) => /now\.$/.test(t));
      expect(turns).toEqual(['Turn left now.', 'Turn right now.', 'Turn right now.']);
      // one line per prompt: the planner fired each prompt exactly once
      expect(new Set(s.ctl.planner.firedIds).size).toBe(s.ctl.planner.firedIds.length);
      expect(says).toHaveLength(multiplier === 10 ? 6 : 12);
      // lines come out in route order (distance at which each was spoken never decreases)
      const at = s.spoken.map((x) => x.atM);
      expect(at).toEqual([...at].sort((a, b) => a - b));
      // the hotspot alert line is spoken once, after the route reaches 2100 m (where the car is within 1 km of it)
      const hs = s.spoken.filter((x) => x.text.startsWith('Rajiv Chowk, rated RED, is to your right'));
      expect(hs).toHaveLength(1);
      expect(hs[0].atM).toBeGreaterThanOrEqual(D.hotspot_events[0].approach_distance_m);
      // the car is always exactly on the line and moves forward only
      let prev = -1;
      for (const f of s.frames) {
        const p = positionAt(D.geometry, f.distanceM);
        expect(haversine([f.lat, f.lon], [p.lat, p.lon])).toBeLessThan(0.01);
        expect(f.distanceM).toBeGreaterThanOrEqual(prev);
        prev = f.distanceM;
      }
      expect(prev).toBeCloseTo(D.total_distance_m, 1);
    });
  }

  it('at 5x the 500 m and 150 m prompts are spoken too, in order before each "now"', () => {
    const s = setup({ multiplier: 5 });
    s.ctl.start();
    s.run();
    const says = s.spoken.map((x) => x.text);
    const i500 = says.indexOf('In 500 metres, turn left onto Golf Course Road.');
    const i150 = says.indexOf('In 150 metres, turn left onto Golf Course Road.');
    const inow = says.indexOf('Turn left now.');
    expect(i500).toBeGreaterThan(0);
    expect(i150).toBeGreaterThan(i500);
    expect(inow).toBeGreaterThan(i150);
  });

  it('at 10x those distance prompts are skipped (they would overlap), but nothing else is lost', () => {
    const s = setup({ multiplier: 10 });
    s.ctl.start();
    s.run();
    expect(s.spoken.some((x) => x.text.startsWith('In '))).toBe(false);
    expect(s.spoken).toHaveLength(1 + 3 + 1 + 1); // start, three turns, hotspot, arrival
  });

  it('never speaks twice in one frame, so lines cannot overlap', () => {
    const s = setup({ multiplier: 20 });
    s.ctl.start();
    const before: number[] = [];
    let last = 0;
    const origSpeak = s.deps.speak as ReturnType<typeof vi.fn>;
    while (s.hasPending()) {
      s.run(1);
      before.push(origSpeak.mock.calls.length - last);
      last = origSpeak.mock.calls.length;
    }
    expect(Math.max(...before)).toBeLessThanOrEqual(1);
  });

  it('the banner data follows the car: next manoeuvre, distance to it, remaining distance and time', () => {
    const s = setup({ multiplier: 10 });
    s.ctl.start();
    s.run(200);
    const h = s.huds[s.huds.length - 1];
    expect(h.next.index).toBe(1);
    expect(h.distanceToNextM).toBeCloseTo(D.steps[1].start_m - h.distanceM, 0);
    expect(h.remainingM).toBeCloseTo(D.total_distance_m - h.distanceM, 0);
    s.run();
    const end = s.huds[s.huds.length - 1];
    expect(end.finished).toBe(true);
    expect(end.next.maneuver).toBe('arrive');
    expect(end.remainingM).toBeCloseTo(0, 1);
    expect(end.remainingS).toBe(0);
  });

  it('shows the hotspot alert only while the car is near it', () => {
    const s = setup({ multiplier: 10 });
    s.ctl.start();
    s.run();
    const withAlert = s.huds.filter((h) => h.alert);
    expect(withAlert.length).toBeGreaterThan(0);
    expect(withAlert.every((h) => h.distanceM >= 2100 - 1 && h.distanceM <= 3300 + 1)).toBe(true);
    expect(s.huds.filter((h) => !h.alert && h.distanceM > 2200 && h.distanceM < 3200)).toHaveLength(0);
  });

  it('zooms in shortly before a turn, never before the arrival', () => {
    const s = setup({ multiplier: 10 });
    s.ctl.start();
    s.run();
    const zoomed = s.frames.filter((f) => f.zoomIn);
    expect(zoomed.length).toBeGreaterThan(0);
    for (const f of zoomed) {
      const next = D.steps.find((st, i) => i > 0 && st.start_m > f.distanceM)!;
      expect(next.maneuver).not.toBe('arrive');
      expect(next.start_m - f.distanceM).toBeLessThanOrEqual(150 + 0.5);
    }
  });
});

describe('controls', () => {
  it('pause stops the car and the voice prompts; resume carries on from the same place', () => {
    const s = setup({ multiplier: 10 });
    s.ctl.start();
    s.run(100);
    const spokenBefore = s.spoken.length;
    s.ctl.pause();
    const stoppedAt = s.frames[s.frames.length - 1].distanceM;
    s.run(300);
    expect(s.frames[s.frames.length - 1].distanceM).toBe(stoppedAt);
    expect(s.spoken).toHaveLength(spokenBefore);
    expect(s.huds[s.huds.length - 1].paused).toBe(true);
    s.ctl.resume();
    s.run(5);
    const after = s.frames[s.frames.length - 1].distanceM;
    expect(after).toBeGreaterThan(stoppedAt);
    expect(after - stoppedAt).toBeLessThan(10 * 0.016 * 5 * 20 + 1); // a few frames of travel, no jump
  });

  it('changing the speed takes effect at once', () => {
    const a = setup({ multiplier: 5 });
    const b = setup({ multiplier: 5 });
    a.ctl.start();
    b.ctl.start();
    b.ctl.setMultiplier(20);
    a.run(100);
    b.run(100);
    expect(b.frames[b.frames.length - 1].distanceM).toBeGreaterThan(a.frames[a.frames.length - 1].distanceM * 3);
    expect(b.huds[b.huds.length - 1].multiplier).toBe(20);
  });

  it('muting silences the prompts (and stops speech) while the car keeps driving; unmuting resumes them', () => {
    const s = setup({ multiplier: 5, muted: true });
    s.ctl.start();
    s.run(3000);
    expect(s.spoken).toHaveLength(0);
    s.ctl.setMuted(false);
    expect(s.ctl.muted).toBe(false);
    s.run();
    expect(s.spoken.length).toBeGreaterThan(0);
    s.ctl.setMuted(true);
    expect(s.deps.stopSpeech).toHaveBeenCalled();
  });

  it('stop() stops the loop and the speech, and is safe to call twice', () => {
    const s = setup();
    s.ctl.start();
    s.run(10);
    const n = s.frames.length;
    s.ctl.stop();
    s.ctl.stop();
    expect(s.hasPending()).toBe(false);
    s.run(10);
    expect(s.frames).toHaveLength(n);
    expect(s.deps.stopSpeech).toHaveBeenCalled();
    expect(s.deps.onArrive).not.toHaveBeenCalled();
  });

  it('tells the screen when the browser blocks speech', async () => {
    const blocked = vi.fn();
    const s = setup({ speak: async () => 'blocked', onVoiceBlocked: blocked });
    s.ctl.start();
    s.run(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(blocked).toHaveBeenCalled();
  });

  it('HUD updates are throttled, frames are not', () => {
    const s = setup({ multiplier: 5, hudEveryMs: 100 });
    s.ctl.start();
    s.run(250); // 4 seconds at 16 ms
    expect(s.frames).toHaveLength(250);
    expect(s.huds.length).toBeLessThan(50);
    expect(s.huds.length).toBeGreaterThan(20);
  });

  it('a tab that was hidden for minutes does not make the car jump', () => {
    const s = setup({ multiplier: 20 });
    s.ctl.start();
    s.run(5);
    const d0 = s.frames[s.frames.length - 1].distanceM;
    s.ctl.step(s.now() + 5 * 60_000);
    const d1 = s.frames[s.frames.length - 1].distanceM;
    expect(d1 - d0).toBeLessThan(0.1 * 20 * 20 + 0.1);
  });
});

describe('the opening line', () => {
  /** A speech stub whose lines finish only when the test says so. */
  function slowSpeech() {
    const waiting: ((r: SpeakResult) => void)[] = [];
    const speak = vi.fn((): Promise<SpeakResult> => new Promise((resolve) => waiting.push(resolve)));
    return { speak, finish: (r: SpeakResult = 'ended') => waiting.splice(0).forEach((w) => w(r)) };
  }
  const flush = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };

  it('keeps the car at the start until the opening line has been spoken, then drives', async () => {
    const sp = slowSpeech();
    const s = setup({ holdForStartLine: true, speak: sp.speak, multiplier: 5 });
    s.ctl.start();
    s.run(100);
    expect(sp.speak).toHaveBeenCalledTimes(1);
    expect(s.frames[s.frames.length - 1].distanceM).toBe(0);
    expect(s.huds[s.huds.length - 1].starting).toBe(true);
    sp.finish();
    await flush();
    s.run(50);
    expect(s.frames[s.frames.length - 1].distanceM).toBeGreaterThan(0);
    expect(s.huds[s.huds.length - 1].starting).toBe(false);
  });

  it('does not wait forever: the car starts after the hold limit even if the line never ends', () => {
    const sp = slowSpeech();
    const s = setup({ holdForStartLine: true, speak: sp.speak, holdMaxMs: 2000 });
    s.ctl.start();
    s.run(100); // 1.6 s
    expect(s.frames[s.frames.length - 1].distanceM).toBe(0);
    s.run(60);
    expect(s.frames[s.frames.length - 1].distanceM).toBeGreaterThan(0);
  });

  it('starts at once when muted, and when speech is blocked or unavailable', async () => {
    const muted = setup({ holdForStartLine: true, muted: true });
    muted.ctl.start();
    muted.run(10);
    expect(muted.frames[muted.frames.length - 1].distanceM).toBeGreaterThan(0);
    for (const result of ['blocked', 'unsupported', 'failed'] as const) {
      const sp = slowSpeech();
      const s = setup({ holdForStartLine: true, speak: sp.speak });
      s.ctl.start();
      s.run(5);
      sp.finish(result);
      await flush();
      s.run(10);
      expect(s.frames[s.frames.length - 1].distanceM).toBeGreaterThan(0);
    }
  });

  it('muting while the opening line plays lets the car go', () => {
    const sp = slowSpeech();
    const s = setup({ holdForStartLine: true, speak: sp.speak });
    s.ctl.start();
    s.run(5);
    s.ctl.setMuted(true);
    s.run(10);
    expect(s.frames[s.frames.length - 1].distanceM).toBeGreaterThan(0);
  });
});

describe('the standing view (before "Show live run")', () => {
  it('shows the car at the start, speaks nothing and does not move until begin()', () => {
    const s = setup({ autoStart: false });
    s.ctl.start();
    s.run(300);
    expect(s.frames.length).toBe(300);
    expect(s.frames.every((f) => f.distanceM === 0)).toBe(true);
    expect(s.spoken).toHaveLength(0);
    expect(s.huds[s.huds.length - 1]).toMatchObject({ idle: true, starting: false, distanceM: 0 });
    expect(s.ctl.isIdle).toBe(true);
  });

  it('begin() starts the run: the opening line is spoken once, then the car drives', () => {
    const s = setup({ autoStart: false });
    s.ctl.start();
    s.run(20);
    s.ctl.begin();
    s.ctl.begin(); // a second press does nothing
    s.run(300);
    expect(s.spoken[0].text).toBe(START);
    expect(s.spoken.filter((x) => x.text === START)).toHaveLength(1);
    expect(s.frames[s.frames.length - 1].distanceM).toBeGreaterThan(0);
    expect(s.huds[s.huds.length - 1].idle).toBe(false);
  });

  it('begin() while the standing view has been shown for a long time does not jump the car', () => {
    const s = setup({ autoStart: false });
    s.ctl.start();
    s.run(5000); // 80 s standing
    s.ctl.begin();
    s.run(3);
    expect(s.frames[s.frames.length - 1].distanceM).toBeLessThan(10);
  });
});
