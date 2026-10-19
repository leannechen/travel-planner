import { addDays, dayDate, weekdayOf, type Trip } from "@travel-planner/shared";
import type { Language } from "./i18n";
import type { MessageKey } from "./messages";

// The Trip's start date ("YYYY-MM-DD"), or undefined when it has none.
export const tripStartDate = (trip: Pick<Trip, "startDate">): string | undefined => trip.startDate ?? undefined;

const WEEKDAY_KEYS: MessageKey[] = ["opening.day0", "opening.day1", "opening.day2", "opening.day3", "opening.day4", "opening.day5", "opening.day6"];

// The message for a weekday (0 is Sunday).
export const weekdayKey = (weekday: number): MessageKey => WEEKDAY_KEYS[weekday]!;

// "11/03": the month and day of a date, for Day headers and tabs.
export const shortDate = (date: string) => date.slice(5).replace("-", "/");

// A Day's date and weekday: "11/03", and the weekday number for its name.
export function dayLabel(startDate: string, position: number): { short: string; weekday: number } {
  return { short: shortDate(dayDate(startDate, position)), weekday: weekdayOf(startDate, position) };
}

// "Tue 3 – Sat 7 Nov" for the Trip's dates in the top bar; the month is written once when both
// dates are in the same month (English). Chinese writes the month with each date.
export function formatTripRange(startDate: string, dayCount: number, language: Language): string {
  const locale = language === "zh" ? "zh-TW" : "en-GB";
  const withMonth = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const dayOnly = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", timeZone: "UTC" });
  const at = (date: string) => new Date(`${date}T00:00:00Z`);
  const endDate = addDays(startDate, dayCount - 1);
  if (dayCount <= 1) return withMonth.format(at(startDate));
  const sameMonth = startDate.slice(0, 7) === endDate.slice(0, 7);
  const first = (sameMonth && language === "en" ? dayOnly : withMonth).format(at(startDate));
  return `${first} – ${withMonth.format(at(endDate))}`;
}
