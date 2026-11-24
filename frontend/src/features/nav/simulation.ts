import type { NavStep } from '@/api/schemas';

export const SPEED_CHOICES = [1, 5, 10, 20] as const;
export type SpeedChoice = (typeof SPEED_CHOICES)[number];

/** Longest slice of real time one frame may advance the drive (a hidden tab or a slow frame must not make the car jump). */
export const MAX_FRAME_S = 0.1;

type Leg = { startM: number; endM: number; startS: number; endS: number };

/**
 * Maps distance along the route <-> drive time, using each step's own free-flow speed (the step's distance divided by
 * its duration from the road graph's travel times), so the car drives faster on an expressway than in a sector road.
 */
export class RouteClock {
  private legs: Leg[] = [];
  readonly totalS: number;
  readonly totalM: number;

  constructor(steps: readonly NavStep[], totalDistanceM: number, totalDurationS: number) {
    const fallback = totalDurationS > 0 ? totalDistanceM / totalDurationS : 10;
    let s = 0;
    for (const step of steps) {
      if (step.maneuver === 'arrive' || step.distance_m <= 0) continue;
      const speed = step.duration_s > 0 ? step.distance_m / step.duration_s : fallback;
      const dur = step.distance_m / speed;
      this.legs.push({ startM: step.start_m, endM: step.start_m + step.distance_m, startS: s, endS: s + dur });
      s += dur;
    }
    this.totalM = totalDistanceM;
    this.totalS = s > 0 ? s : totalDurationS;
  }

  distanceAtTime(t: number): number {
    if (t <= 0 || this.legs.length === 0) return 0;
    if (t >= this.totalS) return this.totalM;
    for (const l of this.legs) {
      if (t <= l.endS) {
        const f = l.endS > l.startS ? (t - l.startS) / (l.endS - l.startS) : 1;
        return l.startM + f * (l.endM - l.startM);
      }
    }
    return this.totalM;
  }

  timeAtDistance(d: number): number {
    if (d <= 0 || this.legs.length === 0) return 0;
    if (d >= this.totalM) return this.totalS;
    for (const l of this.legs) {
      if (d <= l.endM) {
        const f = l.endM > l.startM ? (d - l.startM) / (l.endM - l.startM) : 1;
        return l.startS + f * (l.endS - l.startS);
      }
    }
    return this.totalS;
  }
}

/**
 * The simulated drive. `tick(now)` is called every animation frame with the current time in ms. Pausing stops time
 * (the car stands still); the first tick after a pause or a hidden tab continues from where it was, never jumps.
 */
export class Simulator {
  /** Drive time elapsed, in seconds of the real trip (not of the viewer's clock). */
  elapsedS = 0;
  multiplier: number = 5;
  paused = false;
  private last: number | null = null;

  constructor(private readonly clock: RouteClock) {}

  tick(nowMs: number): number {
    if (this.last !== null && !this.paused) {
      const realDt = Math.min(Math.max(0, (nowMs - this.last) / 1000), MAX_FRAME_S);
      this.elapsedS = Math.min(this.clock.totalS, this.elapsedS + realDt * this.multiplier);
    }
    this.last = nowMs;
    return this.distance;
  }

  get distance(): number {
    return this.clock.distanceAtTime(this.elapsedS);
  }

  get finished(): boolean {
    return this.elapsedS >= this.clock.totalS;
  }

  /** Speed right now in metres per second of the viewer's clock (route speed times the multiplier). */
  get speedMps(): number {
    if (this.paused || this.finished) return 0;
    const d = this.distance;
    const dt = 0.5;
    return ((this.clock.distanceAtTime(this.elapsedS + dt) - d) / dt) * this.multiplier;
  }
}
