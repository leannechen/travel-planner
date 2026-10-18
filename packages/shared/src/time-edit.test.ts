import { describe, expect, it } from "vitest";
import { MAX_DURATION_MINUTES } from "./index";
import { MIN_DURATION_MINUTES, moveEvent, pxToMinutes, resizeBottom, resizeTop, snapToGrid } from "./time-edit";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const bounds = { startMinute: h(8), endMinute: h(22) };

describe("pxToMinutes", () => {
  it("converts pixels to minutes at the axis scale", () => {
    expect(pxToMinutes(64, 64)).toBe(60);
    expect(pxToMinutes(-32, 64)).toBe(-30);
  });

  it("rounds to the nearest snap step", () => {
    expect(pxToMinutes(16, 64)).toBe(15);
    expect(pxToMinutes(7, 64)).toBe(0); // 6.6 minutes
    expect(pxToMinutes(9, 64)).toBe(15); // 8.4 minutes
    expect(pxToMinutes(-9, 64)).toBe(-15);
  });

  it("returns 0, not -0, for a tiny upward move", () => {
    expect(Object.is(pxToMinutes(-1, 64), 0)).toBe(true);
  });
});

describe("moveEvent", () => {
  it("shifts the start and keeps the duration", () => {
    expect(moveEvent({ startMinute: h(10), durationMinutes: 60 }, 30, bounds)).toEqual({
      startMinute: h(10, 30),
      durationMinutes: 60,
    });
  });

  it("stops at the top of the axis", () => {
    expect(moveEvent({ startMinute: h(9), durationMinutes: 60 }, -600, bounds).startMinute).toBe(h(8));
  });

  it("stops where the end reaches the bottom of the axis", () => {
    expect(moveEvent({ startMinute: h(20), durationMinutes: 90 }, 600, bounds).startMinute).toBe(h(20, 30));
  });

  it("does not shift an Event that already runs past the axis when it is not moved", () => {
    const longEvent = { startMinute: h(21), durationMinutes: 180 };
    expect(moveEvent(longEvent, 0, bounds)).toEqual(longEvent);
  });

  it("lets an Event that runs past the axis move up but not further down", () => {
    const longEvent = { startMinute: h(21), durationMinutes: 180 };
    expect(moveEvent(longEvent, -60, bounds).startMinute).toBe(h(20));
    expect(moveEvent(longEvent, 60, bounds).startMinute).toBe(h(21));
  });
});

describe("resizeBottom", () => {
  it("changes the duration and keeps the start", () => {
    expect(resizeBottom({ startMinute: h(10), durationMinutes: 60 }, 30, bounds)).toEqual({
      startMinute: h(10),
      durationMinutes: 90,
    });
  });

  it("never gets shorter than the minimum", () => {
    expect(resizeBottom({ startMinute: h(10), durationMinutes: 60 }, -600, bounds).durationMinutes).toBe(MIN_DURATION_MINUTES);
  });

  it("stops at the bottom of the axis", () => {
    expect(resizeBottom({ startMinute: h(20), durationMinutes: 60 }, 600, bounds).durationMinutes).toBe(120);
  });

  it("keeps an Event that already runs past the axis when it is not resized", () => {
    const longEvent = { startMinute: h(21), durationMinutes: 180 };
    expect(resizeBottom(longEvent, 0, bounds)).toEqual(longEvent);
  });
});

describe("resizeTop", () => {
  it("moves the start and keeps the end where it is", () => {
    expect(resizeTop({ startMinute: h(10), durationMinutes: 60 }, -30, bounds)).toEqual({
      startMinute: h(9, 30),
      durationMinutes: 90,
    });
  });

  it("shortens the Event when dragged down", () => {
    expect(resizeTop({ startMinute: h(10), durationMinutes: 60 }, 15, bounds)).toEqual({
      startMinute: h(10, 15),
      durationMinutes: 45,
    });
  });

  it("never gets shorter than the minimum", () => {
    const result = resizeTop({ startMinute: h(10), durationMinutes: 60 }, 600, bounds);
    expect(result).toEqual({ startMinute: h(10, 60 - MIN_DURATION_MINUTES), durationMinutes: MIN_DURATION_MINUTES });
  });

  it("stops at the top of the axis", () => {
    const result = resizeTop({ startMinute: h(9), durationMinutes: 60 }, -600, bounds);
    expect(result).toEqual({ startMinute: h(8), durationMinutes: 120 });
  });
});

describe("snapping to the grid", () => {
  it("rounds to the nearest 15 minutes", () => {
    expect(snapToGrid(h(10, 7))).toBe(h(10));
    expect(snapToGrid(h(10, 8))).toBe(h(10, 15));
    expect(snapToGrid(h(10, 22))).toBe(h(10, 15));
  });

  it("puts a moved Event that started off the grid on the grid", () => {
    // 10:07 dragged down one step ends on 10:15, not 10:22.
    expect(moveEvent({ startMinute: h(10, 7), durationMinutes: 60 }, 15, bounds).startMinute).toBe(h(10, 15));
  });

  it("leaves an off-grid Event alone when the drag does not move it", () => {
    const offGrid = { startMinute: h(10, 7), durationMinutes: 50 };
    expect(moveEvent(offGrid, 0, bounds)).toEqual(offGrid);
    expect(resizeTop(offGrid, 0, bounds)).toEqual(offGrid);
    expect(resizeBottom(offGrid, 0, bounds)).toEqual(offGrid);
  });

  it("puts a resized edge on the grid", () => {
    // The end 10:57 moved by 15 minutes lands on 11:15.
    expect(resizeBottom({ startMinute: h(10, 7), durationMinutes: 50 }, 15, bounds)).toEqual({
      startMinute: h(10, 7),
      durationMinutes: 68,
    });
    // The start 10:07 moved by -15 is 09:52, whose nearest grid time is 09:45; the end 10:57 stays.
    expect(resizeTop({ startMinute: h(10, 7), durationMinutes: 50 }, -15, bounds)).toEqual({
      startMinute: h(9, 45),
      durationMinutes: 72,
    });
  });

  it("resizes the top of an Event that runs past the axis without pushing its end", () => {
    const longEvent = { startMinute: h(21), durationMinutes: 180 };
    expect(resizeTop(longEvent, -60, bounds)).toEqual({ startMinute: h(20), durationMinutes: 240 });
  });
});

describe("the longest duration", () => {
  const fullDay = { startMinute: 0, endMinute: 1440 };

  it("stops the bottom edge one minute short of a whole day", () => {
    const result = resizeBottom({ startMinute: 0, durationMinutes: 60 }, 2000, fullDay);
    expect(result.durationMinutes).toBeLessThanOrEqual(MAX_DURATION_MINUTES);
  });

  it("stops the top edge so the Event is not longer than the limit", () => {
    const result = resizeTop({ startMinute: h(23), durationMinutes: 60 }, -2000, fullDay);
    expect(result.durationMinutes).toBeLessThanOrEqual(MAX_DURATION_MINUTES);
  });
});
