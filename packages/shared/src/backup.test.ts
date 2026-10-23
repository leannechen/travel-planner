import { describe, expect, it } from "vitest";
import { buildBackup } from "./backup";
import { backupSchema, type Event, type Trip } from "./index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const event = (n: number, extra: Partial<Event> = {}): Event => ({
  id: id(n),
  dayId: null,
  holding: null,
  kind: "attraction",
  title: `Event ${n}`,
  startMinute: 540,
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
  placeId: null,
  destinationId: null,
  openingHoursOn: false,
  imageId: null,
  placePhotoHidden: false,
  ...extra,
});

const trip: Trip = {
  id: id(100),
  title: "Kyoto",
  travelMode: "walk",
  startDate: "2026-11-03",
  role: "owner",
  days: [
    { id: id(201), position: 2, events: [event(3, { dayId: id(201) })] },
    { id: id(200), position: 1, events: [event(1, { dayId: id(200), placeId: "p1" }), event(2, { dayId: id(200), placeId: "p2", openingHoursOn: true })] },
  ],
  backlog: [event(4, { holding: "backlog" })],
  archive: [event(5, { holding: "archive" })],
  todos: [
    { id: id(300), eventId: null, text: "Passport", done: true, createdBy: id(400) },
    { id: id(301), eventId: id(2), text: "Book", done: false, createdBy: id(400) },
  ],
  notes: [
    { id: id(500), body: "recent", pinned: false, updatedAt: "2026-10-02T00:00:00.000Z" },
    { id: id(501), body: "pinned", pinned: true, updatedAt: "2026-10-01T00:00:00.000Z" },
  ],
  legs: [{ id: id(600), dayId: id(200), fromEventId: id(1), toEventId: id(2), mode: "transit", durationMinutes: 10, distanceMeters: 500, manual: false }],
};

describe("buildBackup", () => {
  const image = { contentType: "image/png" as const, data: "aGk=" };
  const backup = buildBackup(trip, new Map([[id(5), image]]));

  it("is a valid backup that survives being written as JSON", () => {
    expect(backupSchema.parse(JSON.parse(JSON.stringify(backup)))).toEqual(backup);
  });
  it("keeps Days in order, the holding areas and the Trip settings", () => {
    expect(backup.trip.days.map((d) => d.map((e) => e.title))).toEqual([["Event 1", "Event 2"], ["Event 3"]]);
    expect(backup.trip.backlog.map((e) => e.title)).toEqual(["Event 4"]);
    expect(backup.trip.archive.map((e) => e.title)).toEqual(["Event 5"]);
    expect(backup.trip).toMatchObject({ title: "Kyoto", travelMode: "walk", startDate: "2026-11-03" });
  });
  it("puts each Todo on its Event, the Trip's own on the Trip", () => {
    expect(backup.trip.todos).toEqual([{ text: "Passport", done: true }]);
    expect(backup.trip.days[0]![1]!.todos).toEqual([{ text: "Book", done: false }]);
  });
  it("keeps a Leg as the mode on the Event it starts from", () => {
    expect(backup.trip.days[0]!.map((e) => e.legToNext)).toEqual(["transit", null]);
  });
  it("keeps Notes in the order the panel shows them, and the images given", () => {
    expect(backup.trip.notes).toEqual([{ body: "pinned", pinned: true }, { body: "recent", pinned: false }]);
    expect(backup.trip.archive[0]!.image).toEqual(image);
    expect(backup.trip.days[0]![0]!.image).toBeNull();
  });
});
