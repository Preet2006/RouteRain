import type { Directions, HotspotEvent } from '@/api/schemas';
import type { SpeakResult, SpeechLanguage } from '@/lib/speech';

import { activeHotspot, guidanceAt, type Guidance } from './guidance';
import { headingAt, positionAt, type NavGeometry } from './geo';
import { PromptPlanner, type Prompt } from './prompts';
import { RouteClock, Simulator } from './simulation';

/** What the map needs every frame. */
export type Frame = {
  lat: number;
  lon: number;
  /** Direction of travel (degrees clockwise from north). */
  heading: number;
  /** Distance driven along the route, in metres. */
  distanceM: number;
  /** True shortly before a manoeuvre: the camera zooms in a little. */
  zoomIn: boolean;
};

/** What the on-screen banner and bars need (sent a few times a second, not every frame). */
export type Hud = Guidance & {
  alert: HotspotEvent | null;
  paused: boolean;
  multiplier: number;
  finished: boolean;
  /** The car is waiting at the start while the opening line is spoken. */
  starting: boolean;
  /** Nothing has been started yet: the screen is the plain, standing view. */
  idle: boolean;
};

export type DriveDeps = {
  directions: Directions;
  language: SpeechLanguage;
  destinationName: string;
  startText: string;
  speak: (text: string, language: SpeechLanguage) => Promise<SpeakResult>;
  stopSpeech: () => void;
  onFrame: (frame: Frame) => void;
  onHud: (hud: Hud) => void;
  onSpoken?: (prompt: Prompt) => void;
  onVoiceBlocked?: () => void;
  onArrive: () => void;
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
  /** Minimum time between HUD updates, ms. */
  hudEveryMs?: number;
  multiplier?: number;
  muted?: boolean;
  /** Start driving at once. Default false: the car stands at the start until begin() is called ("Show live run"). */
  autoStart?: boolean;
  /** Keep the car at the start until the opening line has been spoken (default true). */
  holdForStartLine?: boolean;
  /** ...but never longer than this, ms (default 20 s). */
  holdMaxMs?: number;
};

export const ZOOM_IN_BEFORE_TURN_M = 150;

/**
 * Runs the simulated drive: advances the car every animation frame, feeds the map, decides which voice line is due
 * and tells the screen about progress. Built without React so it can be driven by a manual clock in tests.
 */
export class DriveController {
  readonly clock: RouteClock;
  readonly sim: Simulator;
  readonly planner: PromptPlanner;
  muted: boolean;
  private raf: (cb: (t: number) => void) => number;
  private caf: (id: number) => void;
  private handle: number | null = null;
  private lastHud = -Infinity;
  private arrived = false;
  private stopped = false;
  private holding: boolean;
  private idle: boolean;
  private holdSince: number | null = null;
  private readonly geometry: NavGeometry;

  constructor(private readonly deps: DriveDeps, prompts: Prompt[]) {
    const d = deps.directions;
    this.clock = new RouteClock(d.steps, d.total_distance_m, d.total_duration_s);
    this.sim = new Simulator(this.clock);
    this.sim.multiplier = deps.multiplier ?? 5;
    this.planner = new PromptPlanner(prompts);
    this.muted = deps.muted ?? false;
    this.holding = deps.holdForStartLine ?? true;
    this.idle = !(deps.autoStart ?? false);
    this.geometry = d.geometry;
    this.raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = deps.caf ?? ((id) => cancelAnimationFrame(id));
  }

  start() {
    this.stopped = false;
    if (this.handle === null) this.handle = this.raf(this.loop);
  }

  /** Stops the loop and any speech. Safe to call twice. */
  stop() {
    this.stopped = true;
    if (this.handle !== null) this.caf(this.handle);
    this.handle = null;
    this.deps.stopSpeech();
  }

  pause() {
    this.sim.paused = true;
    this.emitHud(performance.now(), true);
  }

  resume() {
    this.sim.paused = false;
    this.emitHud(performance.now(), true);
  }

  setMultiplier(m: number) {
    this.sim.multiplier = m;
    this.emitHud(performance.now(), true);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      this.deps.stopSpeech();
      this.release(); // nobody is listening to the opening line any more
    }
  }

  /** "Show live run": the opening line is spoken and the simulated drive begins. */
  begin() {
    if (!this.idle) return;
    this.idle = false;
    this.holdSince = null;
    this.emitHud(performance.now(), true);
  }

  get isIdle() {
    return this.idle;
  }

  private release() {
    if (!this.holding) return;
    this.holding = false;
    this.emitHud(performance.now(), true);
  }

  private loop = (now: number) => {
    this.handle = null;
    if (this.stopped) return;
    this.step(now);
    if (!this.stopped && !this.arrived) this.handle = this.raf(this.loop);
  };

  /** One frame. Exposed so tests can drive it with their own clock. */
  step(now: number) {
    if (this.holding && !this.idle) {
      this.holdSince ??= now;
      if (this.muted || now - this.holdSince > (this.deps.holdMaxMs ?? 20_000)) this.release();
    }
    const wasPaused = this.sim.paused;
    if (this.holding || this.idle) this.sim.paused = true; // time stands still before the run and while the opening line is spoken
    const d = this.sim.tick(now);
    this.sim.paused = wasPaused;
    const pos = positionAt(this.geometry, d);
    const guidance = guidanceAt(d, this.deps.directions, this.clock);
    this.deps.onFrame({
      lat: pos.lat,
      lon: pos.lon,
      heading: headingAt(this.geometry, d),
      distanceM: d,
      zoomIn: guidance.next.maneuver !== 'arrive' && guidance.distanceToNextM <= ZOOM_IN_BEFORE_TURN_M,
    });

    const prompt = this.idle ? null : this.planner.due(d, this.sim.multiplier);
    if (prompt && !this.muted) {
      this.deps.onSpoken?.(prompt);
      void this.deps.speak(prompt.text, this.deps.language).then((r) => {
        if (r === 'blocked') this.deps.onVoiceBlocked?.();
        if (prompt.kind === 'start') this.release(); // whatever happened to the line, the trip starts now
      });
    }

    if (this.sim.finished && !this.arrived) {
      this.arrived = true;
      this.emitHud(now, true);
      this.deps.onArrive();
      return;
    }
    this.emitHud(now, false);
  }

  private emitHud(now: number, force: boolean) {
    if (!force && now - this.lastHud < (this.deps.hudEveryMs ?? 100)) return;
    this.lastHud = now;
    const d = this.sim.distance;
    this.deps.onHud({
      ...guidanceAt(d, this.deps.directions, this.clock),
      alert: activeHotspot(d, this.deps.directions.hotspot_events),
      paused: this.sim.paused,
      multiplier: this.sim.multiplier,
      finished: this.sim.finished,
      starting: this.holding && !this.idle,
      idle: this.idle,
    });
  }
}
