import { describe, expect, it } from "vitest";
import { makeDay, makeEvent } from "./test-helpers";
import { previewDrop } from "./dropPreview";

const range = { startMinute: 480, endMinute: 1320 };
const day1 = makeDay(1);
const day2 = makeDay(2);
const event = makeEvent({ dayId: day1.id, holding: null, startMinute: 540, durationMinutes: 60 });

// 64px is one hour on the axis.
describe("previewDrop", () => {
  it("shows nothing when the pointer is over no target, so the card keeps its time", () => {
    expect(previewDrop(event, undefined, 64, range, [day1, day2])).toBeUndefined();
  });

  it("shows the new time within the same Day, without a Day name", () => {
    expect(previewDrop(event, day1.id, 64, range, [day1, day2])).toEqual({ eventId: event.id, startMinute: 600 });
  });

  it("snaps the time like the drop does", () => {
    expect(previewDrop(event, day1.id, 20, range, [day1, day2])).toEqual({ eventId: event.id, startMinute: 555 });
  });

  it("names the other Day, with the time the drop would give there", () => {
    expect(previewDrop(event, day2.id, 128, range, [day1, day2])).toEqual({ eventId: event.id, startMinute: 660, dayPosition: 2 });
  });

  it("keeps the Event inside the axis, as the drop does", () => {
    expect(previewDrop(event, day1.id, -2000, range, [day1, day2])).toEqual({ eventId: event.id, startMinute: 480 });
  });

  it("names the holding area when the pointer is over one", () => {
    expect(previewDrop(event, "backlog", 0, range, [day1, day2])).toEqual({ eventId: event.id, area: "backlog" });
  });
});
