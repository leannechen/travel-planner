import { z } from "zod";
import { formatMinute, MINUTES_PER_DAY } from "./time-layout";

// Opening hours of a place (PRD §3.5): the usual weekly hours, as Google gives them. Times are
// minutes from Sunday 00:00 of the place's local week, so a period may run past midnight, and past
// the end of the week (Saturday night into Sunday) when `end` exceeds a week.
export const WEEK_MINUTES = 7 * MINUTES_PER_DAY;

export const openingHoursSchema = z.object({
  // Google's business status; a place closed for good or for now conflicts with any plan.
  status: z.enum(["open", "closed-temporarily", "closed-permanently"]),
  // Empty means never open. A place open all the time is one period of a whole week.
  periods: z.array(z.object({ start: z.number().int().min(0).lt(WEEK_MINUTES), end: z.number().int().min(1).lt(2 * WEEK_MINUTES) })),
});
export type OpeningHours = z.infer<typeof openingHoursSchema>;

// The same hours on every day of the week.
export function daily(open: number, close: number): OpeningHours {
  return {
    status: "open",
    periods: Array.from({ length: 7 }, (_, d) => ({ start: d * MINUTES_PER_DAY + open, end: d * MINUTES_PER_DAY + close })),
  };
}

// The weekday of a Day: the Trip's start date ("YYYY-MM-DD") plus its position (Day 1 is the start
// date). 0 is Sunday, as in Google's data.
export function weekdayOf(startDate: string, position: number): number {
  const [year, month, day] = startDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + position - 1)).getUTCDay();
}

type Span = { start: number; end: number };

// The periods of the week and of the weeks around it, joined where they meet, so a period that
// wraps past the end of the week, or two days open in a row, is one span.
function openSpans(hours: OpeningHours): Span[] {
  const all = hours.periods
    .flatMap((p) => [-WEEK_MINUTES, 0, WEEK_MINUTES].map((shift) => ({ start: p.start + shift, end: p.end + shift })))
    .sort((a, b) => a.start - b.start);
  const joined: Span[] = [];
  for (const span of all) {
    const last = joined[joined.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else joined.push({ ...span });
  }
  return joined;
}

// Whether the Event, on a Day with this weekday, is not fully inside the opening hours: it starts
// before opening, ends after closing, runs through a break, or the place is closed that day or
// closed in Google's data. An Event running past midnight is checked up to midnight, as the axis
// cuts it.
export function hasOpeningConflict(input: { hours: OpeningHours; weekday: number; startMinute: number; durationMinutes: number }): boolean {
  const { hours, weekday, startMinute, durationMinutes } = input;
  if (hours.status !== "open") return true;
  const from = weekday * MINUTES_PER_DAY + startMinute;
  const to = from + Math.min(durationMinutes, MINUTES_PER_DAY - startMinute);
  return !openSpans(hours).some((span) => span.start <= from && span.end >= to);
}

export type Window = { open: number; close: number };

// The periods that start on a weekday, as minutes from that day's 00:00 (`close` may be past 24:00).
export function dayWindows(hours: OpeningHours, weekday: number): Window[] {
  const base = weekday * MINUTES_PER_DAY;
  return hours.periods
    .filter((p) => p.start >= base && p.start < base + MINUTES_PER_DAY)
    .sort((a, b) => a.start - b.start)
    .map((p) => ({ open: p.start - base, close: p.end - base }));
}

function formatClose(close: number): string {
  let minute = close;
  let nextDays = 0;
  while (minute > MINUTES_PER_DAY) {
    minute -= MINUTES_PER_DAY;
    nextDays += 1;
  }
  const time = minute === MINUTES_PER_DAY ? "24:00" : formatMinute(minute);
  return nextDays > 0 ? `${time} +${nextDays}` : time;
}

// "11:00 – 15:00, 17:00 – 22:00"; undefined for a day with no hours (the interface says "Closed").
export function formatWindows(windows: Window[]): string | undefined {
  if (windows.length === 0) return undefined;
  return windows.map((w) => `${formatMinute(w.open)} – ${formatClose(w.close)}`).join(", ");
}

export type HoursSummary = { kind: "always" } | { kind: "daily"; text: string } | { kind: "varies" };

// The one-line form of the hours: open all the time, the same hours every day, or neither.
export function hoursSummary(hours: OpeningHours): HoursSummary {
  const spans = openSpans(hours);
  if (spans.some((s) => s.end - s.start >= WEEK_MINUTES)) return { kind: "always" };
  const texts = Array.from({ length: 7 }, (_, d) => formatWindows(dayWindows(hours, d)));
  const first = texts[0];
  return first !== undefined && texts.every((t) => t === first) ? { kind: "daily", text: first } : { kind: "varies" };
}
