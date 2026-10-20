import type { Day, Event } from "./index";

// What the Map View draws (PRD §6): a marker for every Event place of the chosen Days, in the order
// of the Day, and the Backlog's places as unscheduled markers. Pure, so the rules can be tested.

export type MapFilter = {
  // One Day to show, or null for all Days.
  dayId: string | null;
  showBacklog: boolean;
  showDayLines: boolean;
};

export type MapBoard = { days: Pick<Day, "id" | "position" | "events">[]; backlog: Event[] };

export type MapMarker = {
  key: string;
  event: Event;
  placeId: string;
  // A Transport event has a departure marker (no number) and a destination marker (numbered).
  role: "place" | "departure" | "destination";
  dayId: string | null;
  dayPosition: number | null;
  // Position among the Day's Events that have a place; null for departures and Backlog Events.
  order: number | null;
};

export type MapLine = {
  // "order" is the dashed line through a Day's order; "transport" the thin line of a Transport event.
  kind: "order" | "transport";
  dayId: string | null;
  from: MapMarker;
  to: MapMarker;
};

export type MapGroup = { dayId: string | null; position: number | null; events: { event: Event; order: number | null }[] };

export type MapPlan = { markers: MapMarker[]; lines: MapLine[]; groups: MapGroup[] };

// The Days' marker colors repeat after this many.
export const DAY_COLOR_COUNT = 8;
export const dayColorIndex = (position: number) => (position - 1) % DAY_COLOR_COUNT;

export function mapPlan(board: MapBoard, filter: MapFilter): MapPlan {
  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const groups: MapGroup[] = [];

  const days = board.days.filter((d) => filter.dayId === null || d.id === filter.dayId);
  for (const day of days) {
    const group: MapGroup = { dayId: day.id, position: day.position, events: [] };
    // The point each located Event takes in the Day's order, to be joined by the dashed line.
    const path: MapMarker[] = [];
    const events = [...day.events].sort((a, b) => a.startMinute - b.startMinute);
    for (const event of events) {
      const placeId = event.placeId;
      const destinationId = event.kind === "transport" ? event.destinationId : null;
      if (!placeId && !destinationId) continue;
      const order = path.length + 1;
      const make = (id: string, role: MapMarker["role"], numbered: boolean): MapMarker => ({
        key: `${event.id}:${role}`,
        event,
        placeId: id,
        role,
        dayId: day.id,
        dayPosition: day.position,
        order: numbered ? order : null,
      });
      if (placeId && destinationId) {
        const departure = make(placeId, "departure", false);
        const destination = make(destinationId, "destination", true);
        markers.push(departure, destination);
        lines.push({ kind: "transport", dayId: day.id, from: departure, to: destination });
        path.push(destination);
      } else {
        const marker = destinationId ? make(destinationId, "destination", true) : make(placeId!, "place", true);
        markers.push(marker);
        path.push(marker);
      }
      group.events.push({ event, order });
    }
    if (filter.showDayLines) {
      path.slice(1).forEach((to, i) => lines.push({ kind: "order", dayId: day.id, from: path[i]!, to }));
    }
    groups.push(group);
  }

  if (filter.showBacklog) {
    const group: MapGroup = { dayId: null, position: null, events: [] };
    for (const event of board.backlog) {
      if (!event.placeId) continue;
      markers.push({ key: `${event.id}:place`, event, placeId: event.placeId, role: "place", dayId: null, dayPosition: null, order: null });
      group.events.push({ event, order: null });
    }
    groups.push(group);
  }

  return { markers, lines, groups };
}
