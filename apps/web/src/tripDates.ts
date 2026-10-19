import type { Trip } from "@travel-planner/shared";

// TEMPORARY: a Trip has no start date yet (setting it comes in a later step), so every Trip starts
// on this day, which lets the opening-hours check run. Replace the body with the Trip's own date,
// or undefined when it has none.
const FAKE_TRIP_START_DATE = "2026-11-03";

// The Trip's start date ("YYYY-MM-DD"), or undefined when it has none.
export function tripStartDate(trip: Pick<Trip, "id">): string | undefined {
  void trip;
  return FAKE_TRIP_START_DATE;
}
