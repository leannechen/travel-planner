import { describe, expect, it } from "vitest";
import { adjacentPairs, keepAdjacentLegs, legEndpoints, legGap, legTooShort, routeUrl } from "./legs";

const ev = (id: string, startMinute: number, durationMinutes: number) => ({ id, startMinute, durationMinutes });
const ids = (pairs: [{ id: string }, { id: string }][]) => pairs.map(([a, b]) => `${a.id}>${b.id}`);

describe("adjacentPairs", () => {
  it("pairs Events in time order, whatever the order of the list", () => {
    expect(ids(adjacentPairs([ev("c", 600, 30), ev("a", 60, 30), ev("b", 300, 30)]))).toEqual(["a>b", "b>c"]);
  });

  it("allows Events that touch", () => {
    expect(ids(adjacentPairs([ev("a", 60, 60), ev("b", 120, 60)]))).toEqual(["a>b"]);
  });

  it("gives no pair for overlapping Events", () => {
    expect(adjacentPairs([ev("a", 60, 90), ev("b", 90, 60)])).toEqual([]);
  });

  it("pairs the Event that ends last with the one that follows the overlap", () => {
    // a runs 60-240 and b 90-120 inside it; c starts after both, so c follows a.
    expect(ids(adjacentPairs([ev("a", 60, 180), ev("b", 90, 30), ev("c", 300, 30)]))).toEqual(["a>c"]);
  });

  it("has no pair for zero or one Event", () => {
    expect(adjacentPairs([])).toEqual([]);
    expect(adjacentPairs([ev("a", 60, 60)])).toEqual([]);
  });
});

describe("legEndpoints", () => {
  const base = { placeId: null, destinationId: null };
  it("uses the place of ordinary Events", () => {
    expect(legEndpoints({ ...base, kind: "attraction", placeId: "p1" }, { placeId: "p2" })).toEqual({
      fromPlaceId: "p1",
      toPlaceId: "p2",
    });
  });
  it("leaves a Transport event from its destination", () => {
    expect(legEndpoints({ kind: "transport", placeId: "dep", destinationId: "dest" }, { placeId: "p2" })).toEqual({
      fromPlaceId: "dest",
      toPlaceId: "p2",
    });
  });
  it("is null where an Event has no place", () => {
    expect(legEndpoints({ ...base, kind: "meal" }, { placeId: null })).toEqual({ fromPlaceId: null, toPlaceId: null });
  });
});

describe("legGap and legTooShort", () => {
  it("measures from the end of the first Event to the start of the second", () => {
    expect(legGap(ev("a", 660, 90), ev("b", 810, 60))).toBe(60);
  });
  it("is too short only when the trip is longer than the gap", () => {
    expect(legTooShort({ durationMinutes: 20 }, 10)).toBe(true);
    expect(legTooShort({ durationMinutes: 20 }, 20)).toBe(false);
    expect(legTooShort({ durationMinutes: null }, 0)).toBe(false);
  });
});

describe("routeUrl", () => {
  it("links to the route with both place ids and the mode", () => {
    const url = new URL(routeUrl({ id: "a", name: "Kyoto Station" }, { id: "b", name: "Kinkaku-ji" }, "walk"));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api: "1",
      origin: "Kyoto Station",
      origin_place_id: "a",
      destination: "Kinkaku-ji",
      destination_place_id: "b",
      travelmode: "walking",
    });
  });
});

describe("keepAdjacentLegs", () => {
  const event = (id: string, startMinute: number, kind = "attraction") =>
    ({ id, startMinute, durationMinutes: 60, kind }) as Parameters<typeof keepAdjacentLegs>[0][number]["events"][number];
  const leg = (dayId: string, fromEventId: string, toEventId: string) => ({ dayId, fromEventId, toEventId });

  it("keeps the Legs of adjacent Events and drops the others", () => {
    const days = [{ id: "d1", events: [event("a", 60), event("b", 200), event("c", 400)] }];
    expect(keepAdjacentLegs(days, [leg("d1", "a", "b"), leg("d1", "a", "c")])).toEqual([leg("d1", "a", "b")]);
  });

  it("drops a Leg whose Event is on another Day or in no Day, and ignores Lodging", () => {
    const days = [
      { id: "d1", events: [event("a", 60), event("stay", 100, "lodging"), event("b", 200)] },
      { id: "d2", events: [event("c", 60)] },
    ];
    expect(keepAdjacentLegs(days, [leg("d1", "a", "b"), leg("d1", "a", "c"), leg("d1", "a", "gone")])).toEqual([leg("d1", "a", "b")]);
  });
});
