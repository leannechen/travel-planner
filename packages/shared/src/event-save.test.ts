import { describe, expect, it } from "vitest";
import { planEventSave } from "./event-save";
import type { Event } from "./index";

const saved: Event = {
  id: "e1",
  dayId: "d1",
  kind: "meal",
  title: "Lunch",
  startMinute: 720,
  durationMinutes: 60,
  transportLabel: null,
};
const fields = {
  title: "Lunch",
  dayId: "d1",
  kind: "meal" as const,
  start: "12:00",
  duration: "60",
  arrival: "13:00",
  transportLabel: "",
};

describe("planEventSave for a new Event", () => {
  it("waits quietly while there is no title", () => {
    expect(planEventSave({ ...fields, title: "   " }, undefined)).toEqual({ kind: "wait" });
  });

  it("creates with trimmed title, times and the chosen Day", () => {
    expect(planEventSave({ ...fields, title: "  Dinner ", dayId: "d2", start: "18:30", duration: "90" }, undefined)).toEqual({
      kind: "create",
      dayId: "d2",
      input: { title: "Dinner", kind: "meal", startMinute: 1110, durationMinutes: 90, transportLabel: null },
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

describe("planEventSave with kinds", () => {
  const transport = { ...fields, kind: "transport" as const, start: "23:00", arrival: "01:30", transportLabel: "ferry" };

  it("creates a Transport event with the duration derived from the arrival", () => {
    expect(planEventSave({ ...transport, title: "Night ferry" }, undefined)).toEqual({
      kind: "create",
      dayId: "d1",
      input: { title: "Night ferry", kind: "transport", startMinute: 1380, durationMinutes: 150, transportLabel: "ferry" },
    });
  });

  it("ignores the duration field for Transport and the arrival field for other kinds", () => {
    const plan = planEventSave({ ...transport, duration: "999999" }, undefined);
    expect(plan.kind).toBe("create");
    expect(planEventSave({ ...fields, arrival: "nonsense" }, saved)).toEqual({ kind: "nothing" });
  });

  it("rejects an arrival equal to the departure or a missing one", () => {
    expect(planEventSave({ ...transport, arrival: "23:00" }, undefined).kind).toBe("error");
    expect(planEventSave({ ...transport, arrival: "" }, undefined).kind).toBe("error");
  });

  it("sends the new kind and keeps the label out of the patch when unchanged", () => {
    expect(planEventSave({ ...fields, kind: "attraction" }, saved)).toEqual({
      kind: "update",
      patch: { kind: "attraction" },
    });
  });

  it("sends a changed or cleared transport label", () => {
    const withLabel = { ...saved, kind: "transport" as const, transportLabel: "train" as const };
    const base = { ...fields, kind: "transport" as const, arrival: "13:00", transportLabel: "train" };
    expect(planEventSave({ ...base, transportLabel: "bus" }, withLabel)).toEqual({
      kind: "update",
      patch: { transportLabel: "bus" },
    });
    expect(planEventSave({ ...base, transportLabel: "" }, withLabel)).toEqual({
      kind: "update",
      patch: { transportLabel: null },
    });
  });

  it("derives a changed duration from a changed arrival for an existing Transport event", () => {
    const existing = { ...saved, kind: "transport" as const };
    expect(
      planEventSave({ ...fields, kind: "transport", arrival: "14:15" }, existing),
    ).toEqual({ kind: "update", patch: { durationMinutes: 135 } });
  });

  it("keeps a saved 24-hour Event valid when it becomes Transport", () => {
    const full = { ...saved, startMinute: 0, durationMinutes: 1440 };
    expect(planEventSave({ ...fields, kind: "transport", start: "00:00", arrival: "00:00" }, full)).toEqual({
      kind: "update",
      patch: { kind: "transport" },
    });
    expect(planEventSave({ ...fields, kind: "transport", start: "00:00", arrival: "00:00" }, undefined).kind).toBe("error");
  });
});
