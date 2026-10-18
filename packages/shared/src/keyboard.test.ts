import { describe, expect, it } from "vitest";
import type { Areas } from "./event-list";
import type { Day, Event } from "./index";
import { adjacentDayId, neighbour, shortcutKeys, withShortcut } from "./keyboard";

const ev = (id: string, startMinute: number): Event => ({ id, startMinute }) as Event;
const day = (id: string, events: Event[]): Day => ({ id, events }) as Day;

const areas: Areas = {
  backlog: [ev("b1", 0)],
  archive: [],
  days: [day("d1", [ev("a", 540), ev("b", 720)]), day("d2", []), day("d3", [ev("c", 600), ev("d", 900)])],
};

describe("neighbour", () => {
  it("selects the first Event when nothing is selected", () => {
    expect(neighbour(areas, undefined, "down")?.id).toBe("b1");
    expect(neighbour({ ...areas, backlog: [] }, undefined, "right")?.id).toBe("a");
  });
  it("returns nothing on an empty board", () => {
    expect(neighbour({ days: [], backlog: [], archive: [] }, undefined, "down")).toBeUndefined();
  });
  it("walks a column with up and down and stops at the ends", () => {
    expect(neighbour(areas, "a", "down")?.id).toBe("b");
    expect(neighbour(areas, "b", "up")?.id).toBe("a");
    expect(neighbour(areas, "a", "up")).toBeUndefined();
    expect(neighbour(areas, "b", "down")).toBeUndefined();
  });
  it("jumps over empty columns and picks the closest start time", () => {
    expect(neighbour(areas, "b", "right")?.id).toBe("c");
    expect(neighbour(areas, "d", "left")?.id).toBe("b");
    expect(neighbour(areas, "a", "right")?.id).toBe("c");
  });
  it("goes from the Backlog to the first Day and back", () => {
    expect(neighbour(areas, "b1", "right")?.id).toBe("a");
    expect(neighbour(areas, "a", "left")?.id).toBe("b1");
  });
  it("has no Event beyond the last column", () => {
    expect(neighbour(areas, "c", "right")).toBeUndefined();
    expect(neighbour(areas, "b1", "left")).toBeUndefined();
  });
  it("leaves the collapsed Archive out, but works inside it", () => {
    const withArchive: Areas = { ...areas, archive: [ev("x", 600), ev("y", 660)] };
    expect(neighbour(withArchive, "b1", "right")?.id).toBe("a");
    expect(neighbour(withArchive, "a", "left")?.id).toBe("b1");
    expect(neighbour(withArchive, "x", "down")?.id).toBe("y");
    expect(neighbour(withArchive, "x", "right")?.id).toBe("a");
    expect(neighbour(withArchive, "x", "left")?.id).toBe("b1");
  });
  it("starts over when the current Event is gone", () => {
    expect(neighbour(areas, "gone", "down")?.id).toBe("b1");
  });
});

describe("adjacentDayId", () => {
  it("finds the neighbouring Days", () => {
    expect(adjacentDayId(areas, "d2", -1)).toBe("d1");
    expect(adjacentDayId(areas, "d2", 1)).toBe("d3");
    expect(adjacentDayId(areas, "d1", -1)).toBeUndefined();
    expect(adjacentDayId(areas, "nope", 1)).toBeUndefined();
  });
});

describe("shortcut labels", () => {
  it("adds the keys to a tooltip", () => {
    expect(shortcutKeys("notes")).toBe("Ctrl+Alt+N");
    expect(withShortcut("Notes", "notes")).toBe("Notes (Ctrl+Alt+N)");
  });
});
