import { describe, expect, it } from "vitest";
import { planDayDeletion } from "./day-deletion";
import type { Day, Event } from "./index";

const ev = (id: string, dayId: string, kind: Event["kind"] = "attraction", nights: number | null = null): Event => ({
  id,
  dayId,
  holding: null,
  kind,
  title: id,
  startMinute: 540,
  durationMinutes: 60,
  transportLabel: null,
  nights,
  checkInMinute: null,
  checkOutMinute: null,
  description: null,
  phone: null,
  email: null,
  website: null,
  bookingUrl: null,
  placeId: null,
  destinationId: null,
  openingHoursOn: false,
});
const day = (id: string, position: number, events: Event[]): Day => ({ id, position, events });

describe("planDayDeletion", () => {
  it("moves every Event of the Day except Lodgings to the Backlog", () => {
    const days = [day("d1", 1, [ev("a", "d1"), ev("b", "d1", "meal")]), day("d2", 2, [ev("c", "d2")])];
    const plan = planDayDeletion(days, "d1");
    expect(plan.moved.map((e) => e.id)).toEqual(["a", "b"]);
    expect(plan.stays).toEqual([]);
  });

  it("takes a night from a stay that covers the Day", () => {
    const stay = ev("h", "d1", "lodging", 3);
    const days = [day("d1", 1, [stay]), day("d2", 2, []), day("d3", 3, [])];
    const plan = planDayDeletion(days, "d2");
    expect(plan.moved).toEqual([]);
    expect(plan.stays).toEqual([
      { event: stay, before: { checkInPosition: 1, nights: 3 }, after: { checkInPosition: 1, nights: 2 } },
    ]);
  });

  it("moves a stay whose only night is the Day to the Backlog", () => {
    const stay = ev("h", "d2", "lodging", 1);
    const days = [day("d1", 1, []), day("d2", 2, [stay])];
    expect(planDayDeletion(days, "d2").moved).toEqual([stay]);
  });

  it("leaves stays before or after the Day alone", () => {
    const before = ev("h1", "d1", "lodging", 1);
    const after = ev("h2", "d3", "lodging", 2);
    const days = [day("d1", 1, [before]), day("d2", 2, []), day("d3", 3, [after]), day("d4", 4, [])];
    const plan = planDayDeletion(days, "d2");
    expect(plan.moved).toEqual([]);
    expect(plan.stays).toEqual([]);
  });

  it("plans nothing for an unknown Day", () => {
    expect(planDayDeletion([day("d1", 1, [ev("a", "d1")])], "x")).toEqual({ moved: [], stays: [] });
  });
});
