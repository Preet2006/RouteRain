import type { Directions, HotspotEvent, NavStep } from '@/api/schemas';

import { RouteClock } from './simulation';

/** A "then ..." hint is shown under the banner only when the manoeuvre after the next one is this close to it. */
export const THEN_WITHIN_M = 200;
/** An avoided hotspot's alert stays up at least this far past where the car is closest to it. */
export const ALERT_MIN_WINDOW_M = 400;

export type Guidance = {
  distanceM: number;
  /** The upcoming manoeuvre (the arrival step when no turn is left). */
  next: NavStep;
  distanceToNextM: number;
  /** The manoeuvre after `next`, only when it is within THEN_WITHIN_M of it (never the arrival). */
  then: NavStep | null;
  remainingM: number;
  remainingS: number;
};

export function guidanceAt(d: number, directions: Directions, clock: RouteClock): Guidance {
  const steps = directions.steps;
  let nextIdx = steps.findIndex((s, i) => i > 0 && s.start_m > d + 0.5);
  if (nextIdx === -1) nextIdx = steps.length - 1;
  const next = steps[nextIdx];
  const after = steps[nextIdx + 1];
  const then = after && after.maneuver !== 'arrive' && after.start_m - next.start_m <= THEN_WITHIN_M ? after : null;
  return {
    distanceM: d,
    next,
    distanceToNextM: Math.max(0, next.start_m - d),
    then,
    remainingM: Math.max(0, directions.total_distance_m - d),
    remainingS: Math.max(0, clock.totalS - clock.timeAtDistance(d)),
  };
}

/** Hotspot events that the car should be told about: those the route keeps clear of, and those it still goes through. */
export const spokenEvents = (events: readonly HotspotEvent[]) => events.filter((e) => e.avoided || e.passes_through);

/** The hotspot alert to show at distance d (the first match), or null. Shown from where the car comes within 1 km. */
export function activeHotspot(d: number, events: readonly HotspotEvent[]): HotspotEvent | null {
  for (const e of spokenEvents(events)) {
    const end = Math.max(e.exit_distance_m, e.approach_distance_m + ALERT_MIN_WINDOW_M);
    if (d >= e.approach_distance_m && d <= end) return e;
  }
  return null;
}
