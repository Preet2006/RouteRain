/** "2026-08-07" -> "7 August 2026". */
export function replayDateLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
