import { describe, expect, it } from "vitest";
import { axisRange, formatMinute, layoutDay, minuteAtOffset, parseTime } from "./time-layout";

const ev = (id: string, start: number, duration: number) => ({
  id,
  startMinute: start,
  durationMinutes: duration,
});
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

function placement(items: ReturnType<typeof ev>[]) {
  return Object.fromEntries(layoutDay(items).map((p) => [p.id, [p.column, p.columnCount]]));
}

describe("layoutDay", () => {
  it("gives a lone Event the full width", () => {
    expect(placement([ev("a", h(9), 60)])).toEqual({ a: [0, 1] });
  });

  it("keeps separate Events in one column each", () => {
    expect(placement([ev("a", h(9), 60), ev("b", h(11), 60)])).toEqual({ a: [0, 1], b: [0, 1] });
  });

  it("does not treat back-to-back Events as overlapping", () => {
    expect(placement([ev("a", h(9), 60), ev("b", h(10), 60)])).toEqual({ a: [0, 1], b: [0, 1] });
  });

  it("puts two overlapping Events side by side", () => {
    expect(placement([ev("a", h(14), 90), ev("b", h(14, 30), 90)])).toEqual({
      a: [0, 2],
      b: [1, 2],
    });
  });

  it("shares a column between Events of one chain that do not overlap each other", () => {
    // a overlaps b, b overlaps c, a and c do not overlap: one group of 2 columns.
    const result = placement([ev("a", h(9), 60), ev("b", h(9, 30), 90), ev("c", h(10, 30), 60)]);
    expect(result).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2] });
  });

  it("splits three simultaneous Events into three columns", () => {
    expect(placement([ev("a", h(9), 60), ev("b", h(9), 60), ev("c", h(9), 60)])).toEqual({
      a: [0, 3],
      b: [1, 3],
      c: [2, 3],
    });
  });

  it("handles an Event nested inside a longer one", () => {
    expect(placement([ev("long", h(9), 240), ev("short", h(10), 30)])).toEqual({
      long: [0, 2],
      short: [1, 2],
    });
  });

  it("sizes each group on its own", () => {
    const result = placement([
      ev("a", h(9), 60),
      ev("b", h(9), 60),
      ev("c", h(13), 60),
    ]);
    expect(result).toEqual({ a: [0, 2], b: [1, 2], c: [0, 1] });
  });

  it("gives the same placement whatever the input order", () => {
    const items = [ev("a", h(9), 60), ev("b", h(9, 30), 90), ev("c", h(9, 30), 90), ev("d", h(12), 30)];
    const forward = placement(items);
    expect(placement([...items].reverse())).toEqual(forward);
    expect(placement([items[2]!, items[0]!, items[3]!, items[1]!])).toEqual(forward);
  });

  it("returns nothing for no Events", () => {
    expect(layoutDay([])).toEqual([]);
  });
});

describe("axisRange", () => {
  it("shows 08:00 to 22:00 by default", () => {
    expect(axisRange([])).toEqual({ startMinute: h(8), endMinute: h(22) });
    expect(axisRange([ev("a", h(10), 60)])).toEqual({ startMinute: h(8), endMinute: h(22) });
  });

  it("grows to whole hours that cover an early Event", () => {
    expect(axisRange([ev("a", h(6, 30), 60)]).startMinute).toBe(h(6));
  });

  it("grows to whole hours that cover a late Event", () => {
    expect(axisRange([ev("a", h(21), 150)]).endMinute).toBe(h(24));
    expect(axisRange([ev("a", h(22), 30)]).endMinute).toBe(h(23));
  });

  it("stops at midnight when an Event runs past it", () => {
    expect(axisRange([ev("a", h(23), 240)]).endMinute).toBe(h(24));
  });
});

describe("time text", () => {
  it("formats minutes as HH:MM", () => {
    expect(formatMinute(0)).toBe("00:00");
    expect(formatMinute(h(9, 5))).toBe("09:05");
    expect(formatMinute(h(23, 59))).toBe("23:59");
  });

  it("formats the end of an Event that runs to midnight as 24:00", () => {
    expect(formatMinute(h(24))).toBe("24:00");
  });

  it("parses HH:MM", () => {
    expect(parseTime("09:05")).toBe(h(9, 5));
    expect(parseTime("00:00")).toBe(0);
  });

  it("rejects text that is not a time", () => {
    expect(parseTime("")).toBeUndefined();
    expect(parseTime("9am")).toBeUndefined();
    expect(parseTime("24:00")).toBeUndefined();
    expect(parseTime("12:60")).toBeUndefined();
  });
});

describe("minuteAtOffset", () => {
  const range = { startMinute: h(8), endMinute: h(22) };
  const PX = 64;

  it("maps the top of the axis to the first minute", () => {
    expect(minuteAtOffset(0, range, PX)).toBe(h(8));
  });

  it("maps one hour of pixels to one hour", () => {
    expect(minuteAtOffset(PX, range, PX)).toBe(h(9));
    expect(minuteAtOffset(PX * 7.5, range, PX)).toBe(h(15, 30));
  });

  it("rounds down to the snap step", () => {
    // 40px is 37.5 minutes after 08:00, so 08:30 with 15-minute steps.
    expect(minuteAtOffset(40, range, PX)).toBe(h(8, 30));
    expect(minuteAtOffset(15, range, PX)).toBe(h(8)); // 14 minutes
    expect(minuteAtOffset(16, range, PX)).toBe(h(8, 15)); // 15 minutes
  });

  it("starts from the widened range", () => {
    expect(minuteAtOffset(PX, { startMinute: h(6), endMinute: h(22) }, PX)).toBe(h(7));
  });

  it("stays inside the axis", () => {
    expect(minuteAtOffset(-50, range, PX)).toBe(h(8));
    expect(minuteAtOffset(10_000, range, PX)).toBe(h(21, 45));
    expect(minuteAtOffset(10_000, { startMinute: h(8), endMinute: h(24) }, PX)).toBe(h(23, 45));
  });
});
