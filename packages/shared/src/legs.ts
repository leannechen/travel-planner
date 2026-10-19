import { z } from "zod";
import type { Event } from "./index";

export const TRAVEL_MODES = ["drive", "transit", "walk"] as const;
export const travelModeSchema = z.enum(TRAVEL_MODES);
export type TravelMode = z.infer<typeof travelModeSchema>;
export const DEFAULT_TRAVEL_MODE: TravelMode = "transit";

// A Leg between two adjacent Events of a Day (PRD §3.3). `durationMinutes` and `distanceMeters`
// are null while the Leg cannot be calculated (an Event has no location, or no route was found).
export const legSchema = z.object({
  id: z.uuid(),
  dayId: z.uuid(),
  fromEventId: z.uuid(),
  toEventId: z.uuid(),
  mode: travelModeSchema,
  durationMinutes: z.number().int().positive().nullable(),
  distanceMeters: z.number().int().nonnegative().nullable(),
});
export type Leg = z.infer<typeof legSchema>;

export const createLegInputSchema = z.object({
  fromEventId: z.uuid(),
  toEventId: z.uuid(),
  mode: travelModeSchema,
});
export const updateLegInputSchema = z.object({ mode: travelModeSchema });
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
