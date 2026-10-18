const MINUTES_PER_DAY = 1440;

// Where a Transport event arrives: the clock time, and how many days after the departure Day.
export function arrivalOf(startMinute: number, durationMinutes: number) {
  const end = startMinute + durationMinutes;
  return { minute: end % MINUTES_PER_DAY, dayOffset: Math.floor(end / MINUTES_PER_DAY) };
}

// The duration implied by a departure and an arrival time. An arrival earlier than the
// departure is the next day. The same time is rejected: it would mean zero or a whole day.
export function durationBetween(startMinute: number, arrivalMinute: number): number | undefined {
  if (arrivalMinute === startMinute) return undefined;
  return (arrivalMinute - startMinute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}
