import { z } from "zod";

// The years a Trip may start in; it keeps half-typed years out.
export const MIN_START_YEAR = 1900;
export const MAX_START_YEAR = 2200;

// A Trip's start date, as "YYYY-MM-DD" with no time zone (PRD §3.1): a calendar date that must exist.
export const startDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "That date does not exist")
  .refine((value) => Number(value.slice(0, 4)) >= MIN_START_YEAR && Number(value.slice(0, 4)) <= MAX_START_YEAR, `Use a year from ${MIN_START_YEAR} to ${MAX_START_YEAR}`);

const parse = (date: string) => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { year, month, day };
};

// The date `days` days after `date`.
export function addDays(date: string, days: number): string {
  const { year, month, day } = parse(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// The date of a Day: the start date plus its position (Day 1 is the start date).
export const dayDate = (startDate: string, position: number) => addDays(startDate, position - 1);
