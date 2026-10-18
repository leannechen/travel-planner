import { describe, expect, it } from "vitest";
import { upsertEvent } from "./event-list";
import type { Day, Event } from "./index";

const ev = (id: string, dayId: string, start: number, title = id): Event => ({
  id,
  dayId,
  kind: "attraction",
  nights: null,
  checkInMinute: null,
  checkOutMinute: null,
  description: null,
  phone: null,
  email: null,
  website: null,
  bookingUrl: null,
  transportLabel: null,
  title,
  startMinute: start,
  durationMinutes: 60,
});
const day = (id: string, position: number, events: Event[]): Day => ({ id, position, events });

describe("upsertEvent", () => {
  it("adds a new Event to its Day in start-time order", () => {
    const days = [day("d1", 1, [ev("a", "d1", 540), ev("c", "d1", 720)]), day("d2", 2, [])];

    const result = upsertEvent(days, ev("b", "d1", 600));

    expect(result[0]!.events.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("replaces an existing Event and re-sorts when its time changes", () => {
    const days = [day("d1", 1, [ev("a", "d1", 540), ev("b", "d1", 600)])];

    const result = upsertEvent(days, ev("a", "d1", 660, "renamed"));

    expect(result[0]!.events.map((e) => [e.id, e.title])).toEqual([
      ["b", "b"],
      ["a", "renamed"],
    ]);
  });

  it("moves an Event to another Day", () => {
    const days = [day("d1", 1, [ev("a", "d1", 540)]), day("d2", 2, [ev("b", "d2", 540)])];

    const result = upsertEvent(days, ev("a", "d2", 480));

    expect(result[0]!.events).toEqual([]);
    expect(result[1]!.events.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("does not change the input", () => {
    const days = [day("d1", 1, [ev("a", "d1", 540)])];
    upsertEvent(days, ev("a", "d1", 600));
    expect(days[0]!.events[0]!.startMinute).toBe(540);
  });

  it("keeps the order of Events that start at the same time", () => {
    const days = [day("d1", 1, [ev("a", "d1", 540), ev("b", "d1", 540)])];
    const result = upsertEvent(days, ev("a", "d1", 540, "edited"));
    expect(result[0]!.events.map((e) => e.id)).toEqual(["a", "b"]);
  });
});
