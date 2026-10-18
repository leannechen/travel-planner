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
  nights: null,
  checkInMinute: null,
  checkOutMinute: null,
  description: null,
  phone: null,
  email: null,
  website: null,
  bookingUrl: null,
};
const noExtras = {
  transportLabel: null,
  nights: null,
  checkInMinute: null,
  checkOutMinute: null,
  description: null,
  phone: null,
  email: null,
  website: null,
  bookingUrl: null,
};
const fields = {
  title: "Lunch",
  dayId: "d1",
  kind: "meal" as const,
  start: "12:00",
  duration: "60",
  arrival: "13:00",
  transportLabel: "",
  nights: "1",
  checkIn: "",
  checkOut: "",
  description: "",
  phone: "",
  email: "",
  website: "",
  bookingUrl: "",
};

describe("planEventSave for a new Event", () => {
  it("waits quietly while there is no title", () => {
    expect(planEventSave({ ...fields, title: "   " }, undefined)).toEqual({ kind: "wait" });
  });

  it("creates with trimmed title, times and the chosen Day", () => {
    expect(planEventSave({ ...fields, title: "  Dinner ", dayId: "d2", start: "18:30", duration: "90" }, undefined)).toEqual({
      kind: "create",
      dayId: "d2",
      input: { title: "Dinner", kind: "meal", startMinute: 1110, durationMinutes: 90, ...noExtras },
    });
  });

  it("reports a bad time or duration", () => {
    for (const bad of [{ start: "" }, { duration: "" }, { duration: "0" }, { duration: "1.5" }, { duration: "1440" }]) {
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
      input: { title: "Night ferry", kind: "transport", startMinute: 1380, durationMinutes: 150, ...noExtras, transportLabel: "ferry" },
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
});

describe("planEventSave for Lodging", () => {
  const lodging = { ...fields, kind: "lodging" as const, nights: "3", checkIn: "15:00", checkOut: "11:00" };
  const savedLodging: Event = { ...saved, kind: "lodging", nights: 3, checkInMinute: 900, checkOutMinute: 660 };

  it("creates a stay with its nights and optional times", () => {
    expect(planEventSave({ ...lodging, title: "Hotel" }, undefined)).toEqual({
      kind: "create",
      dayId: "d1",
      input: {
        title: "Hotel",
        kind: "lodging",
        startMinute: 720,
        durationMinutes: 60,
        transportLabel: null,
        nights: 3,
        checkInMinute: 900,
        checkOutMinute: 660,
        description: null,
        phone: null,
        email: null,
        website: null,
        bookingUrl: null,
      },
    });
  });

  it("leaves the check-in and check-out times empty when blank", () => {
    const plan = planEventSave({ ...lodging, title: "Hotel", checkIn: "", checkOut: " " }, undefined);
    expect(plan).toMatchObject({ kind: "create", input: { checkInMinute: null, checkOutMinute: null } });
  });

  it("rejects bad nights and bad times", () => {
    for (const bad of [{ nights: "" }, { nights: "0" }, { nights: "1.5" }, { nights: "366" }, { checkIn: "25:00" }, { checkOut: "x" }]) {
      expect(planEventSave({ ...lodging, ...bad }, savedLodging).kind).toBe("error");
    }
  });

  it("ignores the hidden start and duration fields", () => {
    expect(planEventSave({ ...lodging, start: "", duration: "nonsense" }, savedLodging)).toEqual({ kind: "nothing" });
  });

  it("sends only what changed", () => {
    expect(planEventSave({ ...lodging, nights: "4", checkOut: "" }, savedLodging)).toEqual({
      kind: "update",
      patch: { nights: 4, checkOutMinute: null },
    });
  });

  it("sends the Lodging fields when an Event becomes a Lodging, and not for other kinds", () => {
    expect(planEventSave({ ...fields, kind: "lodging", nights: "1", checkIn: "12:00" }, saved)).toEqual({
      kind: "update",
      patch: { kind: "lodging", nights: 1, checkInMinute: 720 },
    });
    expect(planEventSave({ ...fields, nights: "5", checkIn: "09:00" }, saved)).toEqual({ kind: "nothing" });
  });
});

describe("planEventSave for Description and contacts", () => {
  it("creates with trimmed values, and null for blank ones", () => {
    const plan = planEventSave(
      { ...fields, title: "Cafe", description: "**Quiet** spot", phone: " +81 3 1234 ", email: "hi@cafe.example", website: "https://cafe.example", bookingUrl: " " },
      undefined,
    );
    expect(plan).toMatchObject({
      kind: "create",
      input: { description: "**Quiet** spot", phone: "+81 3 1234", email: "hi@cafe.example", website: "https://cafe.example", bookingUrl: null },
    });
  });

  it("sends only the details that changed, and null to clear one", () => {
    const withDetails = { ...saved, phone: "123", description: "old" };
    expect(planEventSave({ ...fields, phone: "123", description: "new" }, withDetails)).toEqual({
      kind: "update",
      patch: { description: "new" },
    });
    expect(planEventSave({ ...fields, phone: "", description: "old" }, withDetails)).toEqual({
      kind: "update",
      patch: { phone: null },
    });
  });

  it("rejects a link that is not http or https, and a bad email", () => {
    for (const bad of [{ website: "javascript:alert(1)" }, { website: "cafe.example" }, { bookingUrl: "ftp://x.example" }, { email: "not an email" }]) {
      expect(planEventSave({ ...fields, ...bad }, saved).kind).toBe("error");
    }
  });

  it("rejects a Description that is too long", () => {
    expect(planEventSave({ ...fields, description: "x".repeat(10001) }, saved).kind).toBe("error");
    expect(planEventSave({ ...fields, description: "x".repeat(10000) }, saved).kind).toBe("update");
  });

  it("leaves the fields a kind does not show as they are", () => {
    // Transport has a booking link but no contact; an Attraction has contact but no booking link.
    const transport = { ...saved, kind: "transport" as const, phone: "123" };
    expect(planEventSave({ ...fields, kind: "transport", phone: "999", email: "bad", arrival: "13:00" }, transport)).toEqual({ kind: "nothing" });
    expect(planEventSave({ ...fields, kind: "attraction", bookingUrl: "bad" }, { ...saved, kind: "attraction" })).toEqual({ kind: "nothing" });
  });
});
