import type { Directions } from '@/api/schemas';
import { phrases, type NavLanguage } from '@/lib/navPhrases';

import { spokenEvents } from './guidance';

/** A "500 metres" prompt is only given on a road at least this long, a "150 metres" one on a road at least NEAR_MIN_ROAD_M. */
export const FAR_PROMPT_M = 500;
export const FAR_MIN_ROAD_M = 800;
export const NEAR_PROMPT_M = 150;
export const NEAR_MIN_ROAD_M = 300;
export const NOW_PROMPT_M = 20;
export const ARRIVE_PROMPT_M = 15;
/** Above this speed multiplier the 500 m / 150 m prompts are skipped (they would overlap: the car passes the next one while speaking). */
export const MAX_MULTIPLIER_FOR_DISTANCE_PROMPTS = 5;
/** A prompt we have driven more than this far past (a paused-then-resumed jump, a skipped frame) is dropped, not spoken late. */
export const STALE_M = 60;

export type PromptKind = 'start' | 'far' | 'near' | 'now' | 'hotspot' | 'arrive';

export type Prompt = { id: string; kind: PromptKind; at: number; priority: number; text: string };

const PRIORITY: Record<PromptKind, number> = { far: 0, near: 1, now: 2, hotspot: 2, arrive: 3, start: 3 };

type Options = { language: NavLanguage; destinationName: string; startText: string };

/** Every line that will be spoken on this trip, with the distance along the route at which it is due. Each fires once. */
export function buildPrompts(directions: Directions, { language, destinationName, startText }: Options): Prompt[] {
  const say = phrases(language);
  const steps = directions.steps;
  const out: Prompt[] = [{ id: 'start', kind: 'start', at: 0, priority: PRIORITY.start, text: startText }];
  for (let i = 1; i < steps.length - 1; i++) {
    const s = steps[i];
    const roadM = steps[i - 1].distance_m; // the road that leads up to this manoeuvre
    const add = (kind: PromptKind, at: number, text: string) =>
      out.push({ id: `${kind}-${i}`, kind, at: Math.max(0, at), priority: PRIORITY[kind], text });
    if (roadM >= FAR_MIN_ROAD_M) add('far', s.start_m - FAR_PROMPT_M, say.inMetres(s, FAR_PROMPT_M));
    if (roadM >= NEAR_MIN_ROAD_M) add('near', s.start_m - NEAR_PROMPT_M, say.inMetres(s, NEAR_PROMPT_M));
    add('now', s.start_m - NOW_PROMPT_M, say.now(s));
  }
  for (const e of spokenEvents(directions.hotspot_events)) {
    const text = say.hotspot(e);
    if (text) out.push({ id: `hotspot-${e.hotspot_id}`, kind: 'hotspot', at: e.approach_distance_m, priority: PRIORITY.hotspot, text });
  }
  out.push({ id: 'arrive', kind: 'arrive', at: Math.max(0, directions.total_distance_m - ARRIVE_PROMPT_M), priority: PRIORITY.arrive, text: say.arrive(destinationName) });
  return out.sort((a, b) => a.at - b.at || b.priority - a.priority);
}

/**
 * Decides, as the car moves, which single line to speak now. Each prompt fires once. When several are due at the same
 * moment (a fast simulation, or two manoeuvres close together) only the most important one is spoken and the rest are
 * dropped, so lines never queue up behind each other.
 */
export class PromptPlanner {
  private fired = new Set<string>();

  constructor(private readonly prompts: readonly Prompt[]) {}

  due(distanceM: number, multiplier = 1): Prompt | null {
    const ready = this.prompts.filter((p) => !this.fired.has(p.id) && p.at <= distanceM);
    if (ready.length === 0) return null;
    ready.forEach((p) => this.fired.add(p.id));
    const usable = ready.filter((p) => {
      if (p.kind === 'start' || p.kind === 'arrive') return true;
      if (distanceM - p.at > STALE_M) return false;
      if ((p.kind === 'far' || p.kind === 'near') && multiplier > MAX_MULTIPLIER_FOR_DISTANCE_PROMPTS) return false;
      return true;
    });
    if (usable.length === 0) return null;
    return usable.reduce((best, p) => (p.priority > best.priority || (p.priority === best.priority && p.at > best.at) ? p : best));
  }

  get firedIds(): string[] {
    return [...this.fired];
  }
}
