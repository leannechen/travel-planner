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

// "11/30 (Mon) - 12/03 (Thu)" for the Trip's dates in the top bar; one date when the Trip is one Day.
export function formatTripRange(startDate: string, dayCount: number, language: Language): string {
  const weekday = new Intl.DateTimeFormat(language === "zh" ? "zh-TW" : "en-GB", { weekday: "short", timeZone: "UTC" });
  const part = (date: string) => `${shortDate(date)} (${weekday.format(new Date(`${date}T00:00:00Z`))})`;
  const endDate = addDays(startDate, dayCount - 1);
  return dayCount <= 1 ? part(startDate) : `${part(startDate)} - ${part(endDate)}`;
}
