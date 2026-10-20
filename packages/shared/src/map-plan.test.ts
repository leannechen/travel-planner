import { describe, expect, it } from "vitest";
import { dayColorIndex, DAY_COLOR_COUNT, mapPlan, type MapFilter } from "./map-plan";

type Ev = Parameters<typeof mapPlan>[0]["backlog"][number];

let n = 0;
const ev = (over: Partial<Ev>): Ev =>
  ({
    id: `e${++n}`,
    dayId: null,
    holding: null,
    kind: "attraction",
    title: "x",
    startMinute: 540,
    durationMinutes: 60,
    placeId: null,
    destinationId: null,
    ...over,
  }) as Ev;

const day = (id: string, position: number, events: Ev[]) => ({ id, position, events: events.map((e) => ({ ...e, dayId: id })) });
const all: MapFilter = { dayId: null, showBacklog: true, showDayLines: true };

describe("mapPlan", () => {
  it("leaves out Events without a place", () => {
    const plan = mapPlan({ days: [day("d1", 1, [ev({ title: "idea" }), ev({ placeId: "p1" })])], backlog: [] }, all);
    expect(plan.markers.map((m) => m.placeId)).toEqual(["p1"]);
  });

  it("numbers a Day's markers in the Day's order, counting only Events with a place", () => {
    const plan = mapPlan(
      {
        days: [day("d1", 1, [ev({ placeId: "a", startMinute: 600 }), ev({ startMinute: 700 }), ev({ placeId: "c", startMinute: 800 })])],
        backlog: [],
      },
      all,
    );
    expect(plan.markers.map((m) => [m.placeId, m.order])).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
  });

  it("orders by start time even when the list is not sorted", () => {
    const plan = mapPlan({ days: [day("d1", 1, [ev({ placeId: "late", startMinute: 900 }), ev({ placeId: "early", startMinute: 500 })])], backlog: [] }, all);
    expect(plan.markers.map((m) => [m.placeId, m.order])).toEqual([
      ["early", 1],
      ["late", 2],
    ]);
  });

  it("colors a marker by its Day and cycles through the palette", () => {
    expect(dayColorIndex(1)).toBe(0);
    expect(dayColorIndex(2)).toBe(1);
    expect(dayColorIndex(DAY_COLOR_COUNT + 1)).toBe(0);
  });

  it("shows only the chosen Day, still with the Backlog", () => {
    const plan = mapPlan(
      { days: [day("d1", 1, [ev({ placeId: "a" })]), day("d2", 2, [ev({ placeId: "b" })])], backlog: [ev({ holding: "backlog", placeId: "c" })] },
      { ...all, dayId: "d2" },
    );
    expect(plan.markers.map((m) => m.placeId)).toEqual(["b", "c"]);
  });

  it("marks Backlog Events as unscheduled, without an order, and can leave them out", () => {
    const board = { days: [], backlog: [ev({ holding: "backlog", placeId: "c" })] };
    expect(mapPlan(board, all).markers[0]).toMatchObject({ dayId: null, order: null });
    expect(mapPlan(board, { ...all, showBacklog: false }).markers).toEqual([]);
  });

  it("joins a Day's markers in order with dashed lines, and not across Days", () => {
    const plan = mapPlan(
      {
        days: [
          day("d1", 1, [ev({ placeId: "a", startMinute: 500 }), ev({ placeId: "b", startMinute: 600 }), ev({ placeId: "c", startMinute: 700 })]),
          day("d2", 2, [ev({ placeId: "d" })]),
        ],
        backlog: [],
      },
      all,
    );
    expect(plan.lines.filter((l) => l.kind === "order").map((l) => [l.from.placeId, l.to.placeId])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("draws no Day lines when they are turned off", () => {
    const plan = mapPlan({ days: [day("d1", 1, [ev({ placeId: "a" }), ev({ placeId: "b", startMinute: 700 })])], backlog: [] }, { ...all, showDayLines: false });
    expect(plan.lines.filter((l) => l.kind === "order")).toEqual([]);
  });

  it("gives a Transport event a departure marker, and numbers its destination", () => {
    const plan = mapPlan(
      { days: [day("d1", 1, [ev({ kind: "transport", placeId: "tokyo", destinationId: "kyoto" }), ev({ placeId: "temple", startMinute: 700 })])], backlog: [] },
      all,
    );
    expect(plan.markers.map((m) => [m.placeId, m.role, m.order])).toEqual([
      ["tokyo", "departure", null],
      ["kyoto", "destination", 1],
      ["temple", "place", 2],
    ]);
    const transport = plan.lines.filter((l) => l.kind === "transport");
    expect(transport.map((l) => [l.from.placeId, l.to.placeId])).toEqual([["tokyo", "kyoto"]]);
    // The Day's order runs through the destination, not the departure.
    expect(plan.lines.filter((l) => l.kind === "order").map((l) => [l.from.placeId, l.to.placeId])).toEqual([["kyoto", "temple"]]);
  });

  it("numbers a Transport event with one place at that place", () => {
    const plan = mapPlan({ days: [day("d1", 1, [ev({ kind: "transport", destinationId: "kyoto" })])], backlog: [] }, all);
    expect(plan.markers.map((m) => [m.placeId, m.role, m.order])).toEqual([["kyoto", "destination", 1]]);
  });

  it("gives every marker a distinct key, also when two Events share a place", () => {
    const plan = mapPlan({ days: [day("d1", 1, [ev({ placeId: "a" }), ev({ placeId: "a", startMinute: 700 })])], backlog: [] }, all);
    expect(new Set(plan.markers.map((m) => m.key)).size).toBe(2);
  });

  it("lists the Events on the map by Day, then the Backlog", () => {
    const plan = mapPlan(
      { days: [day("d1", 1, [ev({ placeId: "a" })]), day("d2", 2, [])], backlog: [ev({ holding: "backlog", placeId: "c" })] },
      all,
    );
    expect(plan.groups.map((g) => [g.dayId, g.position, g.events.length])).toEqual([
      ["d1", 1, 1],
      ["d2", 2, 0],
      [null, null, 1],
    ]);
  });
});
