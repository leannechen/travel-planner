import { describe, expect, it } from "vitest";
import {
  dayWindows,
  daily,
  formatWindows,
  hoursSummary,
  hasOpeningConflict,
  weekdayOf,
  type OpeningHours,
} from "./opening-hours";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const SUN = 0;
const MON = 1;
const TUE = 2;
const THU = 4;
const SAT = 6;

// Mon closed, Tue to Fri 11:00 to 15:00 and 17:00 to 22:00, Sat and Sun 11:00 to 22:00.
const restaurant: OpeningHours = {
  status: "open",
  periods: [
    ...[TUE, 3, 4, 5].flatMap((d) => [
      { start: d * 1440 + h(11), end: d * 1440 + h(15) },
      { start: d * 1440 + h(17), end: d * 1440 + h(22) },
    ]),
    ...[SAT, SUN].map((d) => ({ start: d * 1440 + h(11), end: d * 1440 + h(22) })),
  ],
};

describe("weekdayOf", () => {
  it("is the weekday of a Day: the start date plus the position, 0 for Sunday", () => {
    expect(weekdayOf("2026-11-03", 1)).toBe(TUE);
    expect(weekdayOf("2026-11-03", 5)).toBe(SAT);
    expect(weekdayOf("2026-11-03", 6)).toBe(SUN);
    expect(weekdayOf("2026-11-03", 7)).toBe(MON);
  });
  it("crosses month and year ends", () => {
    expect(weekdayOf("2026-12-31", 2)).toBe(5);
  });
});

describe("hasOpeningConflict", () => {
  it("is false when the Event is inside one period", () => {
    expect(hasOpeningConflict({ hours: restaurant, weekday: TUE, startMinute: h(12), durationMinutes: 60 })).toBe(false);
  });
  it("is false when the Event fits exactly", () => {
    expect(hasOpeningConflict({ hours: restaurant, weekday: TUE, startMinute: h(11), durationMinutes: 240 })).toBe(false);
    expect(hasOpeningConflict({ hours: restaurant, weekday: TUE, startMinute: h(17), durationMinutes: 300 })).toBe(false);
  });
  it("is true when the Event starts before opening", () => {
    expect(hasOpeningConflict({ hours: restaurant, weekday: TUE, startMinute: h(10, 30), durationMinutes: 60 })).toBe(true);
  });
  it("is true when the Event ends after closing", () => {
    expect(hasOpeningConflict({ hours: restaurant, weekday: TUE, startMinute: h(21), durationMinutes: 90 })).toBe(true);
  });
  it("is true when the Event runs through a break", () => {
    expect(hasOpeningConflict({ hours: restaurant, weekday: THU, startMinute: h(14), durationMinutes: 180 })).toBe(true);
  });
  it("is true on a closed day", () => {
    expect(hasOpeningConflict({ hours: restaurant, weekday: MON, startMinute: h(12), durationMinutes: 60 })).toBe(true);
  });
  it("is false for a place open all the time", () => {
    const always: OpeningHours = { status: "open", periods: [{ start: 0, end: 7 * 1440 }] };
    expect(hasOpeningConflict({ hours: always, weekday: SAT, startMinute: h(3), durationMinutes: 600 })).toBe(false);
  });
  it("counts hours that run past midnight for the early hours of the next day", () => {
    // Fri and Sat nights 18:00 to 02:00.
    const bar: OpeningHours = {
      status: "open",
      periods: [5, SAT].map((d) => ({ start: d * 1440 + h(18), end: d * 1440 + h(26) })),
    };
    expect(hasOpeningConflict({ hours: bar, weekday: SUN, startMinute: h(0, 30), durationMinutes: 60 })).toBe(false);
    expect(hasOpeningConflict({ hours: bar, weekday: SUN, startMinute: h(1, 30), durationMinutes: 60 })).toBe(true);
    expect(hasOpeningConflict({ hours: bar, weekday: SAT, startMinute: h(20), durationMinutes: 240 })).toBe(false);
  });
  it("wraps from Saturday night to Sunday morning", () => {
    const bar: OpeningHours = { status: "open", periods: [{ start: SAT * 1440 + h(20), end: 7 * 1440 + h(3) }] };
    expect(hasOpeningConflict({ hours: bar, weekday: SUN, startMinute: h(1), durationMinutes: 60 })).toBe(false);
  });
  it("joins periods that meet, as a place open on two days in a row", () => {
    const allDay: OpeningHours = {
      status: "open",
      periods: [
        { start: MON * 1440, end: TUE * 1440 },
        { start: TUE * 1440, end: 3 * 1440 },
      ],
    };
    expect(hasOpeningConflict({ hours: allDay, weekday: MON, startMinute: h(22), durationMinutes: 120 })).toBe(false);
  });
  it("checks an Event that runs past midnight up to midnight, as the axis cuts it", () => {
    expect(hasOpeningConflict({ hours: restaurant, weekday: SAT, startMinute: h(21), durationMinutes: 600 })).toBe(true);
    const lateBar: OpeningHours = { status: "open", periods: [{ start: SAT * 1440 + h(20), end: SAT * 1440 + 1440 }] };
    expect(hasOpeningConflict({ hours: lateBar, weekday: SAT, startMinute: h(21), durationMinutes: 600 })).toBe(false);
  });
  it("is true when Google lists no periods at all (never open)", () => {
    expect(hasOpeningConflict({ hours: { status: "open", periods: [] }, weekday: TUE, startMinute: h(12), durationMinutes: 60 })).toBe(true);
  });
  it("is true for a place closed for good or for now, whatever the hours say", () => {
    for (const status of ["closed-permanently", "closed-temporarily"] as const) {
      expect(hasOpeningConflict({ hours: { ...daily(h(9), h(17)), status }, weekday: TUE, startMinute: h(10), durationMinutes: 60 })).toBe(true);
    }
  });
});

describe("dayWindows", () => {
  it("lists the periods that start on that weekday, in order", () => {
    expect(dayWindows(restaurant, THU)).toEqual([
      { open: h(11), close: h(15) },
      { open: h(17), close: h(22) },
    ]);
    expect(dayWindows(restaurant, MON)).toEqual([]);
  });
  it("keeps a close time past midnight", () => {
    expect(dayWindows({ status: "open", periods: [{ start: 5 * 1440 + h(18), end: 5 * 1440 + h(26) }] }, 5)).toEqual([{ open: h(18), close: h(26) }]);
  });
});

describe("formatWindows", () => {
  it("shows ranges, 'Closed' for none", () => {
    expect(formatWindows([{ open: h(11), close: h(15) }, { open: h(17), close: h(22) }])).toBe("11:00 – 15:00, 17:00 – 22:00");
    expect(formatWindows([])).toBeUndefined();
  });
  it("shows 24:00 for a close at the end of the day and +1 for the next day", () => {
    expect(formatWindows([{ open: 0, close: 1440 }])).toBe("00:00 – 24:00");
    expect(formatWindows([{ open: h(18), close: h(26) }])).toBe("18:00 – 02:00 +1");
  });
});

describe("hoursSummary", () => {
  it("says the place is open all the time", () => {
    expect(hoursSummary({ status: "open", periods: [{ start: 0, end: 7 * 1440 }] })).toEqual({ kind: "always" });
  });
  it("says daily when every day has the same hours", () => {
    expect(hoursSummary(daily(h(9), h(17)))).toEqual({ kind: "daily", text: "09:00 – 17:00" });
  });
  it("otherwise there is no one line", () => {
    expect(hoursSummary(restaurant)).toEqual({ kind: "varies" });
  });
});

describe("daily", () => {
  it("is the same hours on all seven days", () => {
    expect(daily(h(9), h(17)).periods).toHaveLength(7);
  });
});
