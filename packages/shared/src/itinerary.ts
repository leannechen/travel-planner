import { DEFAULT_DURATION_MINUTES, DEFAULT_START_MINUTE, MAX_AI_DAYS, MAX_AI_EVENTS_PER_DAY, MAX_AI_PLACE_LOOKUPS, MAX_DESCRIPTION_LENGTH, MAX_DURATION_MINUTES, MAX_PLACE_QUERY_LENGTH } from "./index";
import type { AiEvent, AiItinerary, SeedEventInput } from "./index";
import type { TravelMode } from "./legs";
import { SNAP_MINUTES } from "./time-layout";
import { startDateSchema } from "./trip-dates";

// A generated Event before its places are looked up: the queries take the place of place ids.
export type GeneratedEvent = Omit<SeedEventInput, "placeId" | "destinationId"> & { placeQuery: string | null; destinationQuery: string | null };
export type GeneratedTrip = { title: string; startDate: string | null; travelMode: TravelMode | null; days: GeneratedEvent[][] };

const MAX_TITLE_LENGTH = 200;
const CHECK_IN_MINUTE = 15 * 60;
const CHECK_OUT_MINUTE = 11 * 60;

const text = (value: string | null, max: number) => {
  const trimmed = value?.trim().slice(0, max) ?? "";
  return trimmed === "" ? null : trimmed;
};
const snapDown = (minute: number) => Math.floor(minute / SNAP_MINUTES) * SNAP_MINUTES;

// "9:30" or "09:30" to minutes from midnight; anything else starts at the default time.
function startOf(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const minute = match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : DEFAULT_START_MINUTE;
  return snapDown(minute);
}

// To the nearest 15 minutes, at least 15 and at most a day.
function durationOf(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DURATION_MINUTES;
  const snapped = Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.min(Math.max(snapped, SNAP_MINUTES), snapDown(MAX_DURATION_MINUTES));
}

// Makes what the model answered fit the app's rules (PRD §7): at most 14 Days and 6 Events a Day,
// times on the 15-minute grid, a Lodging's nights within the Trip, Transport fields only on
// Transport, no Legs (ADR 0002), and at most 60 different places to look up; Events past that
// have no place. Undefined when there is no Event to make a Trip of.
export function normalizeItinerary(itinerary: AiItinerary, options: { fallbackTitle: string }): GeneratedTrip | undefined {
  const lookups = new Set<string>();
  // The query as it will be searched, or null once the lookups are used up (a query already
  // counted is still allowed).
  const query = (value: string | null) => {
    const q = text(value, MAX_PLACE_QUERY_LENGTH);
    if (!q) return null;
    const key = q.toLowerCase();
    if (!lookups.has(key) && lookups.size >= MAX_AI_PLACE_LOOKUPS) return null;
    lookups.add(key);
    return q;
  };

  const dayLists = itinerary.days.slice(0, MAX_AI_DAYS).map((day) => day.events.filter((e) => text(e.title, MAX_TITLE_LENGTH)).slice(0, MAX_AI_EVENTS_PER_DAY));
  const event = (e: AiEvent, dayIndex: number): GeneratedEvent => {
    const lodging = e.kind === "lodging";
    const transport = e.kind === "transport";
    const nightsLeft = dayLists.length - dayIndex;
    return {
      kind: e.kind,
      title: text(e.title, MAX_TITLE_LENGTH)!,
      startMinute: startOf(e.start),
      durationMinutes: durationOf(e.durationMinutes),
      description: text(e.description, MAX_DESCRIPTION_LENGTH),
      transportLabel: transport ? (e.transportLabel ?? "other") : null,
      nights: lodging ? Math.min(Math.max(Math.round(e.nights ?? 1), 1), nightsLeft) : null,
      checkInMinute: lodging ? CHECK_IN_MINUTE : null,
      checkOutMinute: lodging ? CHECK_OUT_MINUTE : null,
      placeQuery: query(e.placeQuery),
      destinationQuery: transport ? query(e.destinationQuery) : null,
      legToNext: null,
    };
  };
  const days = dayLists.map((list, i) => list.map((e) => event(e, i)));
  if (days.every((list) => list.length === 0)) return undefined;

  return {
    title: text(itinerary.title, MAX_TITLE_LENGTH) ?? options.fallbackTitle.trim().slice(0, MAX_TITLE_LENGTH),
    startDate: itinerary.startDate && startDateSchema.safeParse(itinerary.startDate).success ? itinerary.startDate : null,
    travelMode: itinerary.travelMode,
    days,
  };
}
