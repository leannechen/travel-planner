import type { Day, Event } from "./index";

// Everything on the board: the Days and the two holding areas.
export type Areas = { days: Day[]; backlog: Event[]; archive: Event[] };

// Puts `event` where it belongs, replacing any earlier copy of it (also in another area). Events
// of a Day stay in start-time order, and those that start together keep their relative order; a
// holding area keeps the order Events arrived in.
export function upsertEvent(areas: Areas, event: Event): Areas {
  return {
    days: areas.days.map((day) => {
      const existing = day.events.findIndex((e) => e.id === event.id);
      let events = day.events;
      if (existing !== -1 && day.id === event.dayId) {
        events = day.events.map((e) => (e.id === event.id ? event : e));
      } else if (existing !== -1) {
        events = day.events.filter((e) => e.id !== event.id);
      } else if (day.id === event.dayId) {
        events = [...day.events, event];
      }
      return events === day.events
        ? day
        : { ...day, events: [...events].sort((a, b) => a.startMinute - b.startMinute) };
    }),
    backlog: upsertHeld(areas.backlog, event, "backlog"),
    archive: upsertHeld(areas.archive, event, "archive"),
  };
}

function upsertHeld(list: Event[], event: Event, area: Event["holding"]): Event[] {
  const existing = list.findIndex((e) => e.id === event.id);
  if (event.holding !== area) return existing === -1 ? list : list.filter((e) => e.id !== event.id);
  return existing === -1 ? [...list, event] : list.map((e) => (e.id === event.id ? event : e));
}

// The board without `eventId`, wherever that Event was.
export function removeEvent(areas: Areas, eventId: string): Areas {
  const without = (events: Event[]) => events.filter((e) => e.id !== eventId);
  return {
    days: areas.days.map((day) => (day.events.some((e) => e.id === eventId) ? { ...day, events: without(day.events) } : day)),
    backlog: without(areas.backlog),
    archive: without(areas.archive),
  };
}

// Every Event of the board, wherever it is.
export function allEvents(areas: Areas): Event[] {
  return [...areas.days.flatMap((d) => d.events), ...areas.backlog, ...areas.archive];
}
