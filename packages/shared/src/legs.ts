import { z } from "zod";
import type { Event } from "./index";

export const TRAVEL_MODES = ["drive", "transit", "walk"] as const;
export const travelModeSchema = z.enum(TRAVEL_MODES);
export type TravelMode = z.infer<typeof travelModeSchema>;
export const DEFAULT_TRAVEL_MODE: TravelMode = "transit";

// A Leg between two adjacent Events of a Day (PRD §3.3). `durationMinutes` and `distanceMeters`
// are null while the Leg cannot be calculated (an Event has no location, or no route was found).
// `manual` is a duration the user entered for a Leg that could not be calculated (ADR 0009); it has
// no distance.
export const legSchema = z.object({
  id: z.uuid(),
  dayId: z.uuid(),
  fromEventId: z.uuid(),
  toEventId: z.uuid(),
  mode: travelModeSchema,
  durationMinutes: z.number().int().positive().nullable(),
  distanceMeters: z.number().int().nonnegative().nullable(),
  manual: z.boolean(),
});
export type Leg = z.infer<typeof legSchema>;

export const createLegInputSchema = z.object({
  fromEventId: z.uuid(),
  toEventId: z.uuid(),
  mode: travelModeSchema,
});
// The longest duration that can be entered by hand: a whole day.
export const MAX_MANUAL_LEG_MINUTES = 1440;
// A Leg changes its mode (and is calculated again), or is given a duration by hand (null clears it).
export const updateLegInputSchema = z.union([
  z.object({ mode: travelModeSchema }).strict(),
  z.object({ durationMinutes: z.number().int().min(1).max(MAX_MANUAL_LEG_MINUTES).nullable() }).strict(),
]);
export type CreateLegInput = z.infer<typeof createLegInputSchema>;
export type UpdateLegInput = z.infer<typeof updateLegInputSchema>;

type Timed = Pick<Event, "id" | "startMinute" | "durationMinutes">;

const endOf = (e: Timed) => e.startMinute + e.durationMinutes;

// The pairs of Events a Leg can connect: the Events of one Day (Lodging is not on the timeline)
// in time order, where nothing overlaps the stretch between the two. When Events overlap, the
// one that ends last is the one the next Event follows.
export function adjacentPairs<T extends Timed>(events: T[]): [T, T][] {
  const ordered = [...events].sort(
    (a, b) => a.startMinute - b.startMinute || a.durationMinutes - b.durationMinutes || a.id.localeCompare(b.id),
  );
  const pairs: [T, T][] = [];
  let last: T | undefined;
  for (const event of ordered) {
    if (last && endOf(last) <= event.startMinute) pairs.push([last, event]);
    if (!last || endOf(event) >= endOf(last)) last = event;
  }
  return pairs;
}

// The Legs that still join adjacent Events of their Day, for showing a change before the server
// has answered. The server decides for good (PRD §3.3).
export function keepAdjacentLegs<L extends Pick<Leg, "dayId" | "fromEventId" | "toEventId">>(
  days: { id: string; events: Event[] }[],
  legs: L[],
): L[] {
  const adjacent = new Set<string>();
  for (const day of days) {
    for (const [a, b] of adjacentPairs(day.events.filter((e) => e.kind !== "lodging"))) adjacent.add(`${day.id}:${a.id}>${b.id}`);
  }
  return legs.filter((leg) => adjacent.has(`${leg.dayId}:${leg.fromEventId}>${leg.toEventId}`));
}

// The places a Leg runs between: it leaves from where the first Event ends (a Transport event's
// destination) and arrives where the second begins (a Transport event's departure place).
export function legEndpoints(
  from: Pick<Event, "kind" | "placeId" | "destinationId">,
  to: Pick<Event, "placeId">,
): { fromPlaceId: string | null; toPlaceId: string | null } {
  return {
    fromPlaceId: from.kind === "transport" ? from.destinationId : from.placeId,
    toPlaceId: to.placeId,
  };
}

// Minutes between the end of the first Event and the start of the second.
export const legGap = (from: Timed, to: Timed) => to.startMinute - endOf(from);

// The trip is longer than the time between the Events (nothing is moved automatically).
export const legTooShort = (leg: Pick<Leg, "durationMinutes">, gap: number) =>
  leg.durationMinutes !== null && gap < leg.durationMinutes;

const MODE_PARAM: Record<TravelMode, string> = { drive: "driving", transit: "transit", walk: "walking" };

// A Google Maps link to the route; the place ids make Google use exactly those places.
export function routeUrl(
  from: { id: string; name: string },
  to: { id: string; name: string },
  mode: TravelMode,
): string {
  const params = new URLSearchParams({
    api: "1",
    origin: from.name,
    origin_place_id: from.id,
    destination: to.name,
    destination_place_id: to.id,
    travelmode: MODE_PARAM[mode],
  });
  return `https://www.google.com/maps/dir/?${params}`;
}
