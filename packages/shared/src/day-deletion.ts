import { lodgingAfterDelete, type Stay } from "./lodging-range";
import type { Day, Event } from "./index";

export type StayChange = { event: Event; before: Stay; after: Stay };

export type DayDeletionPlan = {
  // The Events that go to the Backlog: everything on the Day except Lodgings, plus a Lodging
  // whose only night is this Day.
  moved: Event[];
  // The Lodgings that lose a night, as they were and as they will be. (A Lodging only shifted by
  // the renumbering is not listed: it stays on the same Day.)
  stays: StayChange[];
};

// What deleting the Day `dayId` does to its Events (PRD §3.1, §3.2). Used for the confirmation
// and by the server, so both agree.
export function planDayDeletion(days: readonly Day[], dayId: string): DayDeletionPlan {
  const target = days.find((d) => d.id === dayId);
  const plan: DayDeletionPlan = { moved: target ? target.events.filter((e) => e.kind !== "lodging") : [], stays: [] };
  if (!target) return plan;
  for (const day of days) {
    for (const event of day.events) {
      if (event.kind !== "lodging" || !event.nights) continue;
      const before = { checkInPosition: day.position, nights: event.nights };
      const after = lodgingAfterDelete(before, target.position);
      if (after === "empty") plan.moved.push(event);
      else if (after.nights !== before.nights) {
        plan.stays.push({ event, before, after });
      }
    }
  }
  return plan;
}
