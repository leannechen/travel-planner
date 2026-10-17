import type { Day, Event } from "./index";

// Puts `event` into its Day, replacing any earlier copy of it (also in another Day), and keeps
// each Day's Events in start-time order. Events that start together keep their relative order.
export function upsertEvent(days: readonly Day[], event: Event): Day[] {
  return days.map((day) => {
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
  });
}
