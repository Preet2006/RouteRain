/** Distance for the big banner: "300 m" under a kilometre (rounded to 10 m, or 5 m under 50 m), "1.2 km" above. */
export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km`;
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.max(0, Math.round(m / 5) * 5)} m`;
}

/** Remaining distance in the bottom bar: always kilometres with one decimal. */
export const formatKm = (m: number) => `${(Math.max(0, m) / 1000).toFixed(1)} km`;

/** Remaining time in whole minutes (at least 1 while there is any way left to go). */
export const formatMinutes = (s: number) => (s <= 0 ? '0 min' : `${Math.max(1, Math.round(s / 60))} min`);

/** Local arrival clock, e.g. "6:42 pm". */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

/** Arrival time if the remaining drive takes remainingS seconds from `now`. */
export const arrivalClock = (now: Date, remainingS: number) => formatClock(new Date(now.getTime() + remainingS * 1000));
