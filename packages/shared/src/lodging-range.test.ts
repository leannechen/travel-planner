import { describe, expect, it } from "vitest";
import { lodgingAfterDelete, lodgingAfterInsert, lodgingBanner, lodgingFits } from "./lodging-range";

// Three nights from Day 2: nights on Days 2 to 4, check-out on Day 5.
const stay = { checkInPosition: 2, nights: 3 };

describe("lodgingAfterInsert (a new Day lands at position p)", () => {
  it("shifts the stay when the Day lands before or at the check-in Day", () => {
    expect(lodgingAfterInsert(stay, 1)).toEqual({ checkInPosition: 3, nights: 3 });
    expect(lodgingAfterInsert(stay, 2)).toEqual({ checkInPosition: 3, nights: 3 });
  });

  it("adds a night when the Day lands between check-in and check-out, including just before the check-out Day", () => {
    expect(lodgingAfterInsert(stay, 3)).toEqual({ checkInPosition: 2, nights: 4 });
    expect(lodgingAfterInsert(stay, 5)).toEqual({ checkInPosition: 2, nights: 4 });
  });

  it("changes nothing when the Day lands after the check-out Day", () => {
    expect(lodgingAfterInsert(stay, 6)).toEqual(stay);
  });
});

describe("lodgingAfterDelete (the Day at position d is removed)", () => {
  it("shifts the stay back when an earlier Day goes", () => {
    expect(lodgingAfterDelete(stay, 1)).toEqual({ checkInPosition: 1, nights: 3 });
  });

  it("removes a night when a covered Day goes, and the check-in stays on the Day that takes its place", () => {
    expect(lodgingAfterDelete(stay, 2)).toEqual({ checkInPosition: 2, nights: 2 });
    expect(lodgingAfterDelete(stay, 3)).toEqual({ checkInPosition: 2, nights: 2 });
    expect(lodgingAfterDelete(stay, 4)).toEqual({ checkInPosition: 2, nights: 2 });
  });

  it("changes nothing when the check-out Day or a later Day goes", () => {
    expect(lodgingAfterDelete(stay, 5)).toEqual(stay);
    expect(lodgingAfterDelete(stay, 6)).toEqual(stay);
  });

  it("reports a stay left with no nights", () => {
    expect(lodgingAfterDelete({ checkInPosition: 2, nights: 1 }, 2)).toBe("empty");
  });
});

describe("lodgingFits", () => {
  it("needs every night to fall on a Day of the Trip; the check-out Day may be past the last one", () => {
    expect(lodgingFits(stay, 4)).toBe(true); // nights on Days 2, 3, 4
    expect(lodgingFits(stay, 5)).toBe(true);
    expect(lodgingFits(stay, 3)).toBe(false);
  });

  it("rejects a check-in before Day 1 and fewer than one night", () => {
    expect(lodgingFits({ checkInPosition: 0, nights: 1 }, 3)).toBe(false);
    expect(lodgingFits({ checkInPosition: 1, nights: 0 }, 3)).toBe(false);
  });
});

describe("lodgingBanner", () => {
  it("numbers the nights, then marks the check-out Day", () => {
    expect(lodgingBanner(stay, 1)).toBeUndefined();
    expect(lodgingBanner(stay, 2)).toEqual({ type: "night", night: 1, of: 3 });
    expect(lodgingBanner(stay, 4)).toEqual({ type: "night", night: 3, of: 3 });
    expect(lodgingBanner(stay, 5)).toEqual({ type: "check-out" });
    expect(lodgingBanner(stay, 6)).toBeUndefined();
  });
});
