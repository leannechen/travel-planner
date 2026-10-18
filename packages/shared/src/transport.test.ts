import { describe, expect, it } from "vitest";
import { arrivalOf, durationBetween } from "./transport";

describe("arrivalOf", () => {
  it("is the start plus the duration on the same day", () => {
    expect(arrivalOf(540, 90)).toEqual({ minute: 630, dayOffset: 0 });
  });

  it("wraps past midnight and counts the extra day", () => {
    expect(arrivalOf(1380, 120)).toEqual({ minute: 60, dayOffset: 1 });
  });

  it("treats exactly midnight as the next day", () => {
    expect(arrivalOf(1380, 60)).toEqual({ minute: 0, dayOffset: 1 });
  });

  it("can span a whole day", () => {
    expect(arrivalOf(600, 1440)).toEqual({ minute: 600, dayOffset: 1 });
  });
});

describe("durationBetween", () => {
  it("is the gap when the arrival is later the same day", () => {
    expect(durationBetween(540, 630)).toBe(90);
  });

  it("reads an earlier arrival as the next day", () => {
    expect(durationBetween(1380, 60)).toBe(120);
  });

  it("rejects an arrival equal to the departure", () => {
    expect(durationBetween(540, 540)).toBeUndefined();
  });

  it("round-trips with arrivalOf", () => {
    for (const [start, duration] of [[0, 1], [1439, 1440], [720, 600], [1380, 300]] as const) {
      expect(durationBetween(start, arrivalOf(start, duration).minute)).toBe(duration === 1440 ? undefined : duration);
    }
  });
});
