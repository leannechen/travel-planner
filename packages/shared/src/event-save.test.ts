import { describe, expect, it } from "vitest";
import { planEventSave } from "./event-save";
import type { Event } from "./index";

const saved: Event = {
  id: "e1",
  dayId: "d1",
  title: "Lunch",
  startMinute: 720,
  durationMinutes: 60,
};
const fields = { title: "Lunch", dayId: "d1", start: "12:00", duration: "60" };

describe("planEventSave for a new Event", () => {
  it("waits quietly while there is no title", () => {
    expect(planEventSave({ ...fields, title: "   " }, undefined)).toEqual({ kind: "wait" });
  });

  it("creates with trimmed title, times and the chosen Day", () => {
    expect(planEventSave({ ...fields, title: "  Dinner ", dayId: "d2", start: "18:30", duration: "90" }, undefined)).toEqual({
      kind: "create",
      dayId: "d2",
      input: { title: "Dinner", startMinute: 1110, durationMinutes: 90 },
    });
  });

  it("reports a bad time or duration", () => {
    for (const bad of [{ start: "" }, { duration: "" }, { duration: "0" }, { duration: "1.5" }, { duration: "1441" }]) {
      expect(planEventSave({ ...fields, ...bad }, undefined).kind).toBe("error");
    }
  });
});

describe("planEventSave for an existing Event", () => {
  it("has nothing to do when nothing changed", () => {
    expect(planEventSave(fields, saved)).toEqual({ kind: "nothing" });
  });

  it("sends only the fields that changed", () => {
    expect(planEventSave({ ...fields, title: "Late lunch", start: "13:00" }, saved)).toEqual({
      kind: "update",
      patch: { title: "Late lunch", startMinute: 780 },
    });
  });

  it("sends the new Day", () => {
    expect(planEventSave({ ...fields, dayId: "d2" }, saved)).toEqual({ kind: "update", patch: { dayId: "d2" } });
  });

  it("does not let the title be emptied", () => {
    expect(planEventSave({ ...fields, title: " " }, saved)).toEqual({ kind: "error", message: "Title is required" });
  });

  it("reports an invalid duration", () => {
    expect(planEventSave({ ...fields, duration: "9999" }, saved).kind).toBe("error");
  });
});
