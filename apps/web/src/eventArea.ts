import type { Event, Place } from "@travel-planner/shared";

// The city is the last part of an area ("Fushimi Ward, Kyoto" -> "Kyoto").
const cityOf = (area: string) => area.split(", ").at(-1)!;

// The area shown after the time on an Event block (PRD §3.2): the place's short area, or for a
// Transport Event with both ends the two cities ("Kyoto → Osaka"), or the areas when both ends
// are in one city; with one end missing, the other end alone. Empty when the Event has no place or the place is unknown.
export function eventArea(event: Pick<Event, "kind" | "placeId" | "destinationId">, places: ReadonlyMap<string, Place>): string {
  const from = event.placeId ? places.get(event.placeId)?.area : undefined;
  if (event.kind !== "transport") return from ?? "";
  const to = event.destinationId ? places.get(event.destinationId)?.area : undefined;
  // A place without an area (a transit line has no address) leaves its end out: the origin alone,
  // or the destination after an arrow so it is not taken for the origin.
  if (!from || !to) return from ? from : to ? `→ ${to}` : "";
  return cityOf(from) === cityOf(to) ? `${from} → ${to}` : `${cityOf(from)} → ${cityOf(to)}`;
}
