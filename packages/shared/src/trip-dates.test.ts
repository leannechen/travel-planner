import { describe, expect, it } from "vitest";
import { addDays, dayDate, startDateSchema } from "./trip-dates";

describe("startDateSchema", () => {
  it("accepts a real calendar date", () => {
    expect(startDateSchema.safeParse("2026-11-03").success).toBe(true);
    expect(startDateSchema.safeParse("2028-02-29").success).toBe(true);
  });
  it("refuses other texts and dates that do not exist", () => {
    for (const bad of ["", "2026-2-3", "03/11/2026", "2026-02-30", "2027-02-29", "2026-13-01", "2026-11-03T00:00", "0002-11-03", "110320-02-06", "2201-01-01"]) {
      expect(startDateSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("addDays", () => {
  it("moves across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-11-03", 0)).toBe("2026-11-03");
  });
});

describe("dayDate", () => {
  it("is the start date for Day 1 and one day more for each position after", () => {
    expect(dayDate("2026-11-03", 1)).toBe("2026-11-03");
    expect(dayDate("2026-11-03", 5)).toBe("2026-11-07");
    expect(dayDate("2026-11-29", 3)).toBe("2026-12-01");
  });
});
