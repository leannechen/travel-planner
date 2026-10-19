import { describe, expect, it } from "vitest";
import { dayLabel, formatTripRange, shortDate, tripStartDate } from "./tripDates";

describe("trip dates", () => {
  it("reads the Trip's start date, undefined without one", () => {
    expect(tripStartDate({ startDate: "2026-11-03" })).toBe("2026-11-03");
    expect(tripStartDate({ startDate: null })).toBeUndefined();
  });

  it("labels a Day with its month and day and its weekday", () => {
    expect(dayLabel("2026-11-03", 1)).toEqual({ short: "11/03", weekday: 2 });
    expect(dayLabel("2026-11-03", 5)).toEqual({ short: "11/07", weekday: 6 });
    expect(dayLabel("2026-11-29", 3)).toEqual({ short: "12/01", weekday: 2 });
    expect(shortDate("2026-01-09")).toBe("01/09");
  });

  it("writes the Trip's range in the interface language", () => {
    expect(formatTripRange("2026-11-03", 5, "en")).toBe("Tue 3 – Sat 7 Nov");
    expect(formatTripRange("2026-11-03", 1, "en")).toBe("Tue 3 Nov");
    expect(formatTripRange("2026-11-03", 5, "zh")).toContain("11");
  });
});
