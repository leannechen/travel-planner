import { describe, expect, it } from "vitest";
import { removeEvent, upsertEvent } from "./event-list";
import type { Areas } from "./event-list";
import type { Day, Event } from "./index";

const ev = (id: string, dayId: string, start: number, title = id): Event => ({
  id,
  dayId,
  holding: null,
  kind: "attraction",
  nights: null,
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
  imageId: null,
  placePhotoHidden: false,
  transportLabel: null,
  title,
  startMinute: start,
  durationMinutes: 60,
});
const day = (id: string, position: number, events: Event[]): Day => ({ id, position, events });
const held = (id: string, holding: "backlog" | "archive", title = id): Event => ({ ...ev(id, "x", 540, title), dayId: null, holding });
const board = (days: Day[], backlog: Event[] = [], archive: Event[] = []): Areas => ({ days, backlog, archive });

describe("upsertEvent", () => {
  it("adds a new Event to its Day in start-time order", () => {
    const days = [day("d1", 1, [ev("a", "d1", 540), ev("c", "d1", 720)]), day("d2", 2, [])];

    const result = upsertEvent(board(days), ev("b", "d1", 600));

    expect(result.days[0]!.events.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("replaces an existing Event and re-sorts when its time changes", () => {
    const days = [day("d1", 1, [ev("a", "d1", 540), ev("b", "d1", 600)])];

    const result = upsertEvent(board(days), ev("a", "d1", 660, "renamed"));

    expect(result.days[0]!.events.map((e) => [e.id, e.title])).toEqual([
      ["b", "b"],
      ["a", "renamed"],
    ]);
  });

  it("moves an Event to another Day", () => {
    const days = [day("d1", 1, [ev("a", "d1", 540)]), day("d2", 2, [ev("b", "d2", 540)])];

    const result = upsertEvent(board(days), ev("a", "d2", 480));

    expect(result.days[0]!.events).toEqual([]);
    expect(result.days[1]!.events.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("does not change the input", () => {
    const days = [day("d1", 1, [ev("a", "d1", 540)])];
    upsertEvent(board(days), ev("a", "d1", 600));
    expect(days[0]!.events[0]!.startMinute).toBe(540);
  });

  it("keeps the order of Events that start at the same time", () => {
    const days = [day("d1", 1, [ev("a", "d1", 540), ev("b", "d1", 540)])];
    const result = upsertEvent(board(days), ev("a", "d1", 540, "edited"));
    expect(result.days[0]!.events.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("moves an Event from a Day into the Backlog, appended after the others", () => {
    const areas = board([day("d1", 1, [ev("a", "d1", 540)])], [held("x", "backlog")]);
    const result = upsertEvent(areas, held("a", "backlog"));
    expect(result.days[0]!.events).toEqual([]);
    expect(result.backlog.map((e) => e.id)).toEqual(["x", "a"]);
  });

  it("moves an Event from the Archive onto a Day", () => {
    const areas = board([day("d1", 1, [ev("b", "d1", 600)])], [], [held("a", "archive")]);
    const result = upsertEvent(areas, ev("a", "d1", 540));
    expect(result.archive).toEqual([]);
    expect(result.days[0]!.events.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("replaces an Event inside its holding area in place", () => {
    const areas = board([], [held("a", "backlog"), held("b", "backlog")]);
    const result = upsertEvent(areas, held("a", "backlog", "renamed"));
    expect(result.backlog.map((e) => e.title)).toEqual(["renamed", "b"]);
  });
});

describe("removeEvent", () => {
  it("removes an Event from a Day, the Backlog or the Archive, and leaves the rest", () => {
    const a = ev("a", "d1", 540);
    const b = ev("b", "d1", 600);
    const areas = board([day("d1", 1, [a, b])], [held("x", "backlog")], [held("y", "archive")]);

    expect(removeEvent(areas, "a").days[0]!.events).toEqual([b]);
    expect(removeEvent(areas, "x").backlog).toEqual([]);
    expect(removeEvent(areas, "y").archive).toEqual([]);
    expect(removeEvent(areas, "x").days[0]).toBe(areas.days[0]);
  });

  it("changes nothing for an unknown id", () => {
    const areas = board([day("d1", 1, [ev("a", "d1", 540)])]);
    expect(removeEvent(areas, "zzz")).toEqual(areas);
  });
});
