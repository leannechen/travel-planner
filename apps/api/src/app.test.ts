import { daySchema, dayDeletionSchema, deletedEventSchema, eventSchema, healthResponseSchema, noteSchema, tripSchema } from "@travel-planner/shared";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { trips, users, days, events } from "./db/schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test/test-app";
import { fakePlaceProvider, PlaceProviderError } from "./places";

let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});

beforeEach(async () => {
  await app.reset();
});

afterAll(() => app.stop());

function post(path: string, body: unknown) {
  return fetch(`${app.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createTrip(title: string) {
  const res = await post("/api/trips", { title });
  return { res, trip: tripSchema.parse(await res.json()) };
}

describe("GET /api/health", () => {
  it("returns the shared health payload", async () => {
    const res = await fetch(`${app.baseUrl}/api/health`);
    expect(healthResponseSchema.parse(await res.json())).toEqual({ status: "ok" });
  });
});

describe("trips", () => {
  it("creates a Trip that starts with Day 1 and no Events", async () => {
    const { res, trip } = await createTrip("Kyoto");

    expect(res.status).toBe(201);
    expect(trip.title).toBe("Kyoto");
    expect(trip.days).toHaveLength(1);
    expect(trip.days[0]).toMatchObject({ position: 1, events: [] });
  });

  it("rejects a blank title", async () => {
    const res = await post("/api/trips", { title: "   " });
    expect(res.status).toBe(400);
  });

  it("lists the Trips with their Events", async () => {
    const { trip } = await createTrip("Kyoto");
    const dayId = trip.days[0]!.id;
    await post(`/api/trips/${trip.id}/days/${dayId}/events`, { title: "Fushimi Inari" });

    const res = await fetch(`${app.baseUrl}/api/trips`);
    const trips = z.array(tripSchema).parse(await res.json());

    expect(trips).toHaveLength(1);
    expect(trips[0]!.days[0]!.events.map((e) => e.title)).toEqual(["Fushimi Inari"]);
  });
});

describe("events", () => {
  it("adds an Event to a Day", async () => {
    const { trip } = await createTrip("Kyoto");
    const dayId = trip.days[0]!.id;

    const res = await post(`/api/trips/${trip.id}/days/${dayId}/events`, { title: "Kiyomizu-dera" });

    expect(res.status).toBe(201);
    expect(eventSchema.parse(await res.json())).toMatchObject({ dayId, title: "Kiyomizu-dera" });
  });

  it("returns 404 for a Day that is not in the Trip", async () => {
    const { trip } = await createTrip("Kyoto");
    const unknownDay = "11111111-1111-4111-8111-111111111111";

    const res = await post(`/api/trips/${trip.id}/days/${unknownDay}/events`, { title: "Nowhere" });

    expect(res.status).toBe(404);
  });

  it("rejects a blank title", async () => {
    const { trip } = await createTrip("Kyoto");
    const res = await post(`/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, { title: "" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a real Day posted under another Trip", async () => {
    const { trip: tripA } = await createTrip("Kyoto");
    const { trip: tripB } = await createTrip("Osaka");

    const res = await post(`/api/trips/${tripB.id}/days/${tripA.days[0]!.id}/events`, { title: "Mixed up" });

    expect(res.status).toBe(404);
  });

  it("returns 404 for a Day in someone else's Trip and does not list that Trip", async () => {
    const [other] = await app.db.insert(users).values({}).returning();
    const [theirTrip] = await app.db
      .insert(trips)
      .values({ ownerId: other!.id, title: "Not yours" })
      .returning();
    const [theirDay] = await app.db.insert(days).values({ tripId: theirTrip!.id, position: 1 }).returning();

    const res = await post(`/api/trips/${theirTrip!.id}/days/${theirDay!.id}/events`, { title: "Intruder" });
    const listed = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json());

    expect(res.status).toBe(404);
    expect(listed).toEqual([]);
  });

  it("trims the title and returns Events in creation order", async () => {
    const { trip } = await createTrip("Kyoto");
    const path = `/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`;
    await post(path, { title: "  First  " });
    await post(path, { title: "Second" });

    const listed = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json());

    expect(listed[0]!.days[0]!.events.map((e) => e.title)).toEqual(["First", "Second"]);
  });
});

const daysSchema = z.array(daySchema);

function send(method: "PUT" | "DELETE" | "PATCH", path: string, body?: unknown) {
  return fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Creates a Trip with `count` Days and returns the Trip and its Day ids in position order.
async function tripWithDays(count: number) {
  const { trip } = await createTrip("Kyoto");
  for (let i = 1; i < count; i++) await post(`/api/trips/${trip.id}/days`, { position: i + 1 });
  const rows = await app.db.select().from(days).where(eq(days.tripId, trip.id)).orderBy(days.position);
  return { trip, ids: rows.map((r) => r.id) };
}

async function positionsOf(tripId: string) {
  const rows = await app.db.select().from(days).where(eq(days.tripId, tripId)).orderBy(days.position);
  return rows.map((r) => ({ id: r.id, position: r.position }));
}

describe("inserting a Day", () => {
  it("inserts in the middle and renumbers later Days", async () => {
    const { trip, ids } = await tripWithDays(3);

    const res = await post(`/api/trips/${trip.id}/days`, { position: 2 });
    const result = daysSchema.parse(await res.json());

    expect(res.status).toBe(201);
    expect(result.map((d) => d.position)).toEqual([1, 2, 3, 4]);
    expect(result[0]!.id).toBe(ids[0]);
    expect(result[2]!.id).toBe(ids[1]);
    expect(result[3]!.id).toBe(ids[2]);
    expect(result[1]!.events).toEqual([]);
  });

  it("appends at position N+1", async () => {
    const { trip } = await tripWithDays(2);
    const res = await post(`/api/trips/${trip.id}/days`, { position: 3 });
    expect(daysSchema.parse(await res.json()).map((d) => d.position)).toEqual([1, 2, 3]);
  });

  it("rejects a position past N+1 and a non-positive position", async () => {
    const { trip } = await tripWithDays(2);
    expect((await post(`/api/trips/${trip.id}/days`, { position: 4 })).status).toBe(400);
    expect((await post(`/api/trips/${trip.id}/days`, { position: 0 })).status).toBe(400);
    expect(await positionsOf(trip.id)).toHaveLength(2);
  });

  it("returns 404 for an unknown Trip", async () => {
    const res = await post("/api/trips/11111111-1111-4111-8111-111111111111/days", { position: 1 });
    expect(res.status).toBe(404);
  });

  it("keeps Events with their Day", async () => {
    const { trip, ids } = await tripWithDays(2);
    await post(`/api/trips/${trip.id}/days/${ids[1]}/events`, { title: "Kinkaku-ji" });

    const result = daysSchema.parse(await (await post(`/api/trips/${trip.id}/days`, { position: 1 })).json());

    expect(result.map((d) => d.events.map((e) => e.title))).toEqual([[], [], ["Kinkaku-ji"]]);
  });
});

describe("reordering Days", () => {
  it("applies the new order and numbers Days by position", async () => {
    const { trip, ids } = await tripWithDays(3);
    const order = [ids[2]!, ids[0]!, ids[1]!];

    const res = await send("PUT", `/api/trips/${trip.id}/days/order`, { dayIds: order });
    const result = daysSchema.parse(await res.json());

    expect(res.status).toBe(200);
    expect(result.map((d) => d.id)).toEqual(order);
    expect(result.map((d) => d.position)).toEqual([1, 2, 3]);
    expect(await positionsOf(trip.id)).toEqual(order.map((id, i) => ({ id, position: i + 1 })));
  });

  it("moves Events with their Day", async () => {
    const { trip, ids } = await tripWithDays(2);
    await post(`/api/trips/${trip.id}/days/${ids[0]}/events`, { title: "Nishiki Market" });

    const res = await send("PUT", `/api/trips/${trip.id}/days/order`, { dayIds: [ids[1], ids[0]] });
    const result = daysSchema.parse(await res.json());

    expect(result[1]!.events.map((e) => e.title)).toEqual(["Nishiki Market"]);
  });

  it("rejects a list that misses, repeats or adds a Day and changes nothing", async () => {
    const { trip, ids } = await tripWithDays(2);
    const path = `/api/trips/${trip.id}/days/order`;
    const stranger = "11111111-1111-4111-8111-111111111111";

    expect((await send("PUT", path, { dayIds: [ids[0]] })).status).toBe(400);
    expect((await send("PUT", path, { dayIds: [ids[0], ids[0]] })).status).toBe(400);
    expect((await send("PUT", path, { dayIds: [ids[0], ids[1], stranger] })).status).toBe(400);
    expect((await send("PUT", path, { dayIds: "nope" })).status).toBe(400);
    expect((await positionsOf(trip.id)).map((d) => d.id)).toEqual(ids);
  });

  it("returns 404 for someone else's Trip", async () => {
    const [other] = await app.db.insert(users).values({}).returning();
    const [theirTrip] = await app.db.insert(trips).values({ ownerId: other!.id, title: "Theirs" }).returning();
    const [theirDay] = await app.db.insert(days).values({ tripId: theirTrip!.id, position: 1 }).returning();

    const res = await send("PUT", `/api/trips/${theirTrip!.id}/days/order`, { dayIds: [theirDay!.id] });

    expect(res.status).toBe(404);
  });

  it("survives concurrent reorders with valid, unique positions", async () => {
    const { trip, ids } = await tripWithDays(4);
    const path = `/api/trips/${trip.id}/days/order`;

    const responses = await Promise.all([
      send("PUT", path, { dayIds: [...ids].reverse() }),
      send("PUT", path, { dayIds: [ids[1], ids[2], ids[3], ids[0]] }),
      send("PUT", path, { dayIds: [ids[3], ids[0], ids[1], ids[2]] }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const final = await positionsOf(trip.id);
    expect(final.map((d) => d.position)).toEqual([1, 2, 3, 4]);
    // The result is one of the submitted orders as a whole, not a mix of them.
    const submitted = [
      [...ids].reverse(),
      [ids[1], ids[2], ids[3], ids[0]],
      [ids[3], ids[0], ids[1], ids[2]],
    ];
    expect(submitted).toContainEqual(final.map((d) => d.id));
  });

  it("keeps positions 1..N when Days are inserted and deleted at the same time", async () => {
    const { trip, ids } = await tripWithDays(4);

    const responses = await Promise.all([
      post(`/api/trips/${trip.id}/days`, { position: 1 }),
      send("DELETE", `/api/trips/${trip.id}/days/${ids[1]}`),
      send("DELETE", `/api/trips/${trip.id}/days/${ids[2]}`),
    ]);

    expect(responses.map((r) => r.status)).toEqual([201, 200, 200]);
    const final = await positionsOf(trip.id);
    expect(final.map((d) => d.position)).toEqual([1, 2, 3]);
    expect(final.map((d) => d.id)).toContain(ids[0]);
    expect(final.map((d) => d.id)).toContain(ids[3]);
  });
});

describe("deleting a Day", () => {
  it("deletes an empty Day and renumbers the rest", async () => {
    const { trip, ids } = await tripWithDays(3);

    const res = await send("DELETE", `/api/trips/${trip.id}/days/${ids[1]}`);
    const result = dayDeletionSchema.parse(await res.json());

    expect(res.status).toBe(200);
    expect(result.days.map((d) => d.id)).toEqual([ids[0], ids[2]]);
    expect(result.days.map((d) => d.position)).toEqual([1, 2]);
    expect(result.backlog).toEqual([]);
  });

  it("moves the Events of a deleted Day to the Backlog, keeping their details", async () => {
    const { trip, ids } = await tripWithDays(2);
    await post(`/api/trips/${trip.id}/days/${ids[0]}/events`, { title: "Gion", startMinute: 600, durationMinutes: 90 });
    await post(`/api/trips/${trip.id}/days/${ids[0]}/events`, { title: "Tea", kind: "meal" });

    const res = await send("DELETE", `/api/trips/${trip.id}/days/${ids[0]}`);
    const result = dayDeletionSchema.parse(await res.json());

    expect(res.status).toBe(200);
    expect(result.days.map((d) => d.id)).toEqual([ids[1]]);
    expect(result.backlog.map((e) => e.title)).toEqual(["Gion", "Tea"]);
    expect(result.backlog[0]).toMatchObject({ dayId: null, holding: "backlog", startMinute: 600, durationMinutes: 90 });
    expect(await positionsOf(trip.id)).toEqual([{ id: ids[1], position: 1 }]);
  });

  it("puts the moved Events after those already in the Backlog", async () => {
    const { trip, ids } = await tripWithDays(2);
    await post(`/api/trips/${trip.id}/backlog/events`, { title: "Idea" });
    await post(`/api/trips/${trip.id}/days/${ids[1]}/events`, { title: "Gion" });

    const result = dayDeletionSchema.parse(await (await send("DELETE", `/api/trips/${trip.id}/days/${ids[1]}`)).json());

    expect(result.backlog.map((e) => e.title)).toEqual(["Idea", "Gion"]);
  });

  it("refuses to delete the last Day", async () => {
    const { trip, ids } = await tripWithDays(1);
    const res = await send("DELETE", `/api/trips/${trip.id}/days/${ids[0]}`);
    expect(res.status).toBe(409);
  });

  it("returns 404 for a Day posted under another Trip", async () => {
    const { ids } = await tripWithDays(2);
    const { trip: other } = await createTrip("Osaka");

    const res = await send("DELETE", `/api/trips/${other.id}/days/${ids[0]}`);

    expect(res.status).toBe(404);
  });
});

describe("adding an Event while its Day is deleted", () => {
  it("never reports an Event as created and then loses it", async () => {
    // Repeated because the race depends on timing.
    for (let i = 0; i < 10; i++) {
      const { trip, ids } = await tripWithDays(2);
      const [add, del] = await Promise.all([
        post(`/api/trips/${trip.id}/days/${ids[1]}/events`, { title: "Race" }),
        send("DELETE", `/api/trips/${trip.id}/days/${ids[1]}`),
      ]);

      const [listed] = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json()).filter((t) => t.id === trip.id);
      const titles = [...listed!.days.flatMap((d) => d.events), ...listed!.backlog].map((e) => e.title);
      expect(del.status).toBe(200);
      if (add.status === 201) {
        // The Event exists, so the delete came after it and moved it to the Backlog.
        expect(listed!.backlog.map((e) => e.title)).toEqual(["Race"]);
      } else {
        expect(add.status).toBe(404);
        expect(titles).toEqual([]);
      }
    }
  });
});

describe("Event times", () => {
  async function addEvent(tripId: string, dayId: string, body: unknown) {
    return post(`/api/trips/${tripId}/days/${dayId}/events`, body);
  }

  it("stores the start time and duration", async () => {
    const { trip } = await createTrip("Kyoto");

    const res = await addEvent(trip.id, trip.days[0]!.id, { title: "Dinner", startMinute: 1110, durationMinutes: 90 });

    expect(res.status).toBe(201);
    expect(eventSchema.parse(await res.json())).toMatchObject({ startMinute: 1110, durationMinutes: 90 });
  });

  it("defaults to 09:00 for 60 minutes when no time is given", async () => {
    const { trip } = await createTrip("Kyoto");
    const res = await addEvent(trip.id, trip.days[0]!.id, { title: "Walk" });
    expect(eventSchema.parse(await res.json())).toMatchObject({ startMinute: 540, durationMinutes: 60 });
  });

  it("rejects times outside the allowed range", async () => {
    const { trip } = await createTrip("Kyoto");
    const dayId = trip.days[0]!.id;

    for (const bad of [
      { startMinute: -1 },
      { startMinute: 1440 },
      { startMinute: 90.5 },
      { durationMinutes: 0 },
      { durationMinutes: 1440 },
      { durationMinutes: "60" },
    ]) {
      expect((await addEvent(trip.id, dayId, { title: "Bad", ...bad })).status).toBe(400);
    }
  });

  it("accepts the edge values, including an Event that runs past midnight", async () => {
    const { trip } = await createTrip("Kyoto");
    const dayId = trip.days[0]!.id;

    for (const times of [
      { startMinute: 0, durationMinutes: 1 },
      { startMinute: 1439, durationMinutes: 1439 },
      { startMinute: 1380, durationMinutes: 240 },
    ]) {
      const res = await addEvent(trip.id, dayId, { title: "Edge", ...times });
      expect(res.status).toBe(201);
      expect(eventSchema.parse(await res.json())).toMatchObject(times);
    }
  });

  it("lists a Day's Events by start time", async () => {
    const { trip } = await createTrip("Kyoto");
    const dayId = trip.days[0]!.id;
    await addEvent(trip.id, dayId, { title: "Dinner", startMinute: 1110 });
    await addEvent(trip.id, dayId, { title: "Breakfast", startMinute: 480 });
    await addEvent(trip.id, dayId, { title: "Lunch", startMinute: 720 });

    const listed = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json());

    expect(listed[0]!.days[0]!.events.map((e) => e.title)).toEqual(["Breakfast", "Lunch", "Dinner"]);
  });
});

describe("updating an Event", () => {
  async function eventIn(tripId: string, dayId: string, body: Record<string, unknown> = {}) {
    const res = await post(`/api/trips/${tripId}/days/${dayId}/events`, { title: "Original", ...body });
    return eventSchema.parse(await res.json());
  }

  it("changes only the fields that are sent", async () => {
    const { trip } = await createTrip("Kyoto");
    const event = await eventIn(trip.id, trip.days[0]!.id, { startMinute: 600, durationMinutes: 45 });

    const res = await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { title: "  Renamed  " });

    expect(res.status).toBe(200);
    expect(eventSchema.parse(await res.json())).toEqual({ ...event, title: "Renamed" });
  });

  it("changes the time and duration", async () => {
    const { trip } = await createTrip("Kyoto");
    const event = await eventIn(trip.id, trip.days[0]!.id);

    const res = await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, {
      startMinute: 1110,
      durationMinutes: 120,
    });

    expect(eventSchema.parse(await res.json())).toMatchObject({ startMinute: 1110, durationMinutes: 120 });
  });

  it("moves an Event to another Day of the Trip", async () => {
    const { trip, ids } = await tripWithDays(2);
    const event = await eventIn(trip.id, ids[0]!);

    const res = await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { dayId: ids[1] });
    const listed = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json());

    expect(eventSchema.parse(await res.json()).dayId).toBe(ids[1]);
    expect(listed[0]!.days.map((d) => d.events.length)).toEqual([0, 1]);
  });

  it("refuses a Day of another Trip and leaves the Event where it was", async () => {
    const { trip } = await createTrip("Kyoto");
    const { trip: other } = await createTrip("Osaka");
    const event = await eventIn(trip.id, trip.days[0]!.id);

    const res = await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { dayId: other.days[0]!.id });
    const listed = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json());

    expect(res.status).toBe(400);
    expect(listed.find((t) => t.id === trip.id)!.days[0]!.events).toHaveLength(1);
  });

  it("rejects an empty change, a blank title and out-of-range times", async () => {
    const { trip } = await createTrip("Kyoto");
    const event = await eventIn(trip.id, trip.days[0]!.id);
    const path = `/api/trips/${trip.id}/events/${event.id}`;

    for (const bad of [{}, { title: "  " }, { startMinute: 1440 }, { durationMinutes: 0 }, { dayId: "nope" }]) {
      expect((await send("PATCH", path, bad)).status).toBe(400);
    }
  });

  it("returns 404 for an unknown Event, an Event under another Trip and someone else's Event", async () => {
    const { trip } = await createTrip("Kyoto");
    const { trip: other } = await createTrip("Osaka");
    const event = await eventIn(trip.id, trip.days[0]!.id);
    const unknown = "11111111-1111-4111-8111-111111111111";

    expect((await send("PATCH", `/api/trips/${trip.id}/events/${unknown}`, { title: "x" })).status).toBe(404);
    expect((await send("PATCH", `/api/trips/${other.id}/events/${event.id}`, { title: "x" })).status).toBe(404);

    const [stranger] = await app.db.insert(users).values({}).returning();
    const [theirTrip] = await app.db.insert(trips).values({ ownerId: stranger!.id, title: "Theirs" }).returning();
    const [theirDay] = await app.db.insert(days).values({ tripId: theirTrip!.id, position: 1 }).returning();
    const [theirEvent] = await app.db.insert(events).values({ tripId: theirTrip!.id, dayId: theirDay!.id, title: "Theirs" }).returning();
    expect((await send("PATCH", `/api/trips/${theirTrip!.id}/events/${theirEvent!.id}`, { title: "x" })).status).toBe(404);
  });

  it("never moves an Event into a Day that is being deleted", async () => {
    // Repeated because the race depends on timing.
    for (let i = 0; i < 10; i++) {
      const { trip, ids } = await tripWithDays(2);
      const event = await eventIn(trip.id, ids[0]!);

      const [move, del] = await Promise.all([
        send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { dayId: ids[1] }),
        send("DELETE", `/api/trips/${trip.id}/days/${ids[1]}`),
      ]);

      const listed = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json());
      const board = listed.find((t) => t.id === trip.id)!;
      const stillThere = [...board.days.flatMap((d) => d.events), ...board.backlog];
      // The Event is never lost: either the move won (and the delete then sent it to the Backlog)
      // or the delete won (and the move was refused).
      expect(stillThere.map((e) => e.id)).toEqual([event.id]);
      expect(del.status).toBe(200);
      if (move.status === 200) expect(board.backlog.map((e) => e.id)).toEqual([event.id]);
      else expect([400, 404]).toContain(move.status);
    }
  });
});

describe("Event kinds", () => {
  async function newEvent(body: Record<string, unknown> = {}) {
    const { trip } = await createTrip("Kyoto");
    const res = await post(`/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, { title: "Thing", ...body });
    return { trip, res };
  }

  it("makes an Attraction without a transport label by default", async () => {
    const { res } = await newEvent();
    expect(res.status).toBe(201);
    expect(eventSchema.parse(await res.json())).toMatchObject({ kind: "attraction", transportLabel: null });
  });

  it("creates a Transport event with its label", async () => {
    const { res } = await newEvent({ kind: "transport", transportLabel: "ferry", startMinute: 1380, durationMinutes: 150 });
    expect(eventSchema.parse(await res.json())).toMatchObject({
      kind: "transport",
      transportLabel: "ferry",
      durationMinutes: 150,
    });
  });

  it("rejects an unknown kind or transport label", async () => {
    expect((await newEvent({ kind: "hotel" })).res.status).toBe(400);
    expect((await newEvent({ transportLabel: "rocket" })).res.status).toBe(400);
  });

  it("changes the kind, keeping the label, and lists the kind", async () => {
    const { trip, res } = await newEvent({ kind: "transport", transportLabel: "train" });
    const event = eventSchema.parse(await res.json());

    const patched = await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { kind: "meal" });

    expect(eventSchema.parse(await patched.json())).toMatchObject({ kind: "meal", transportLabel: "train" });
    const listed = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json());
    expect(listed[0]!.days[0]!.events[0]).toMatchObject({ kind: "meal", transportLabel: "train" });
  });

  it("clears the transport label with null", async () => {
    const { trip, res } = await newEvent({ kind: "transport", transportLabel: "bus" });
    const event = eventSchema.parse(await res.json());

    const patched = await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { transportLabel: null });

    expect(eventSchema.parse(await patched.json()).transportLabel).toBeNull();
  });
});

describe("Lodging", () => {
  async function stay(tripId: string, dayId: string, nights: number, body: Record<string, unknown> = {}) {
    const res = await post(`/api/trips/${tripId}/days/${dayId}/events`, { title: "Hotel", kind: "lodging", nights, ...body });
    return { res, event: res.ok ? eventSchema.parse(await res.json()) : undefined };
  }

  async function lodgingOf(tripId: string) {
    const [trip] = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json()).filter((t) => t.id === tripId);
    const all = trip!.days.flatMap((d) => d.events.filter((e) => e.kind === "lodging").map((e) => ({ ...e, position: d.position })));
    return all[0]!;
  }

  it("stores the nights and the optional times", async () => {
    const { trip, ids } = await tripWithDays(4);
    const { res, event } = await stay(trip.id, ids[0]!, 3, { checkInMinute: 900, checkOutMinute: 660 });
    expect(res.status).toBe(201);
    expect(event).toMatchObject({ kind: "lodging", nights: 3, checkInMinute: 900, checkOutMinute: 660 });
  });

  it("needs at least one night, and every night on a Day of the Trip", async () => {
    const { trip, ids } = await tripWithDays(3);
    expect((await stay(trip.id, ids[0]!, 0)).res.status).toBe(400);
    expect((await stay(trip.id, ids[1]!, 3)).res.status).toBe(400); // Days 2 to 4 do not exist
    expect((await stay(trip.id, ids[1]!, 2)).res.status).toBe(201); // Days 2 and 3, check-out after the Trip
    const noNights = await post(`/api/trips/${trip.id}/days/${ids[0]!}/events`, { title: "Hotel", kind: "lodging" });
    expect(noNights.status).toBe(400);
  });

  it("checks the fit when an Event becomes a Lodging or its nights or Day change", async () => {
    const { trip, ids } = await tripWithDays(3);
    const res = await post(`/api/trips/${trip.id}/days/${ids[0]!}/events`, { title: "Thing" });
    const event = eventSchema.parse(await res.json());
    const patch = (body: unknown) => send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, body);

    expect((await patch({ kind: "lodging" })).status).toBe(400); // no nights yet
    expect((await patch({ kind: "lodging", nights: 4 })).status).toBe(400);
    expect((await patch({ kind: "lodging", nights: 3 })).status).toBe(200);
    expect((await patch({ nights: 4 })).status).toBe(400);
    expect((await patch({ dayId: ids[1]! })).status).toBe(400); // Days 2 to 4
    expect((await patch({ nights: 2, dayId: ids[1]! })).status).toBe(200);
  });

  it("keeps the Lodging fields when the kind changes away and back", async () => {
    const { trip, ids } = await tripWithDays(3);
    const { event } = await stay(trip.id, ids[0]!, 2, { checkInMinute: 840 });
    await send("PATCH", `/api/trips/${trip.id}/events/${event!.id}`, { kind: "attraction" });
    expect(await lodgingOf(trip.id).catch(() => undefined)).toBeUndefined();
    const back = await send("PATCH", `/api/trips/${trip.id}/events/${event!.id}`, { kind: "lodging" });
    expect(eventSchema.parse(await back.json())).toMatchObject({ nights: 2, checkInMinute: 840 });
  });

  describe("when Days are inserted", () => {
    // Three nights from Day 2 in a 5-Day Trip: nights on Days 2 to 4, check-out on Day 5.
    async function setup() {
      const { trip, ids } = await tripWithDays(5);
      const { event } = await stay(trip.id, ids[1]!, 3);
      return { trip, ids, event: event! };
    }
    const insert = (tripId: string, position: number) => post(`/api/trips/${tripId}/days`, { position });

    it("shifts the stay when inserting before the check-in Day", async () => {
      const { trip, ids } = await setup();
      await insert(trip.id, 1);
      expect(await lodgingOf(trip.id)).toMatchObject({ position: 3, nights: 3, dayId: ids[1] });
    });

    it("adds a night when inserting between check-in and check-out, even just before the check-out Day", async () => {
      const { trip } = await setup();
      await insert(trip.id, 3);
      expect(await lodgingOf(trip.id)).toMatchObject({ position: 2, nights: 4 });
      await insert(trip.id, 6); // the check-out Day is now Day 6
      expect(await lodgingOf(trip.id)).toMatchObject({ position: 2, nights: 5 });
    });

    it("makes a Day added at the end the check-out Day when the stay had none", async () => {
      const { trip, ids } = await tripWithDays(3);
      await stay(trip.id, ids[0]!, 3); // nights on Days 1 to 3, check-out after the Trip
      await insert(trip.id, 4);
      expect(await lodgingOf(trip.id)).toMatchObject({ position: 1, nights: 3 });
    });

    it("changes nothing when inserting after the check-out Day", async () => {
      const { trip } = await setup();
      await insert(trip.id, 6);
      expect(await lodgingOf(trip.id)).toMatchObject({ position: 2, nights: 3 });
    });
  });

  describe("when Days are deleted", () => {
    async function setup() {
      const { trip, ids } = await tripWithDays(6);
      const { event } = await stay(trip.id, ids[1]!, 3); // nights on Days 2 to 4, check-out Day 5
      return { trip, ids, event: event! };
    }
    const remove = (tripId: string, dayId: string) => send("DELETE", `/api/trips/${tripId}/days/${dayId}`);

    it("shifts the stay back when an earlier Day goes", async () => {
      const { trip, ids } = await setup();
      expect((await remove(trip.id, ids[0]!)).status).toBe(200);
      expect(await lodgingOf(trip.id)).toMatchObject({ position: 1, nights: 3 });
    });

    it("removes a night when a covered Day goes", async () => {
      const { trip, ids } = await setup();
      expect((await remove(trip.id, ids[2]!)).status).toBe(200);
      expect(await lodgingOf(trip.id)).toMatchObject({ position: 2, nights: 2, dayId: ids[1] });
    });

    it("moves the check-in to the Day that takes the place of a deleted check-in Day", async () => {
      const { trip, ids } = await setup();
      expect((await remove(trip.id, ids[1]!)).status).toBe(200);
      expect(await lodgingOf(trip.id)).toMatchObject({ position: 2, nights: 2, dayId: ids[2] });
    });

    it("changes nothing when the check-out Day or a later Day goes", async () => {
      const { trip, ids } = await setup();
      await remove(trip.id, ids[4]!);
      await remove(trip.id, ids[5]!);
      expect(await lodgingOf(trip.id)).toMatchObject({ position: 2, nights: 3 });
    });

    it("moves a stay left with no nights to the Backlog", async () => {
      const { trip, ids } = await tripWithDays(3);
      await stay(trip.id, ids[1]!, 1, { checkInMinute: 900 });
      const res = await remove(trip.id, ids[1]!);
      const result = dayDeletionSchema.parse(await res.json());
      expect(res.status).toBe(200);
      expect(result.backlog).toHaveLength(1);
      expect(result.backlog[0]).toMatchObject({ kind: "lodging", nights: 1, checkInMinute: 900, dayId: null, holding: "backlog" });
      expect(await positionsOf(trip.id)).toHaveLength(2);
    });

    it("moves the other Events of the Day to the Backlog but keeps the stay that only has its check-in there", async () => {
      const { trip, ids } = await setup();
      await post(`/api/trips/${trip.id}/days/${ids[1]!}/events`, { title: "Castle" });
      const result = dayDeletionSchema.parse(await (await remove(trip.id, ids[1]!)).json());
      expect(result.backlog.map((e) => e.title)).toEqual(["Castle"]);
      expect(await lodgingOf(trip.id)).toMatchObject({ position: 2, nights: 2, dayId: ids[2] });
    });
  });

  it("stays on the same positions when Days are reordered", async () => {
    const { trip, ids } = await tripWithDays(4);
    await stay(trip.id, ids[0]!, 2);

    const res = await send("PUT", `/api/trips/${trip.id}/days/order`, { dayIds: [ids[1], ids[0], ids[2], ids[3]] });

    expect(res.status).toBe(200);
    expect(await lodgingOf(trip.id)).toMatchObject({ position: 1, nights: 2, dayId: ids[1] });
  });
});

describe("Description and contacts", () => {
  async function newEvent(body: Record<string, unknown> = {}) {
    const { trip } = await createTrip("Kyoto");
    const res = await post(`/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, { title: "Cafe", ...body });
    return { trip, res };
  }

  it("stores the Description and contacts, trimmed", async () => {
    const { res } = await newEvent({
      description: "  **Quiet** spot\n\n- [ ] ask for a window seat ",
      phone: " +81 3 1234 5678 ",
      email: "hi@cafe.example",
      website: "https://cafe.example/menu",
      bookingUrl: "http://booking.example/r/1",
    });
    expect(res.status).toBe(201);
    expect(eventSchema.parse(await res.json())).toMatchObject({
      description: "**Quiet** spot\n\n- [ ] ask for a window seat",
      phone: "+81 3 1234 5678",
      email: "hi@cafe.example",
      website: "https://cafe.example/menu",
      bookingUrl: "http://booking.example/r/1",
    });
  });

  it("has none by default", async () => {
    const { res } = await newEvent();
    expect(eventSchema.parse(await res.json())).toMatchObject({
      description: null,
      phone: null,
      email: null,
      website: null,
      bookingUrl: null,
    });
  });

  it("rejects links that are not http or https, a bad email and values that are too long", async () => {
    for (const bad of [
      { website: "javascript:alert(1)" },
      { website: "cafe.example" },
      { bookingUrl: "ftp://files.example" },
      { bookingUrl: "https://" + "a".repeat(2000) },
      { email: "not an email" },
      { description: "x".repeat(10001) },
      { phone: "1".repeat(51) },
    ]) {
      expect((await newEvent(bad)).res.status).toBe(400);
    }
  });

  it("changes and clears a value, and keeps it when the kind changes", async () => {
    const { trip, res } = await newEvent({ phone: "123", description: "Notes" });
    const event = eventSchema.parse(await res.json());
    const patch = async (body: unknown) =>
      eventSchema.parse(await (await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, body)).json());

    expect(await patch({ phone: "456" })).toMatchObject({ phone: "456", description: "Notes" });
    expect(await patch({ kind: "transport" })).toMatchObject({ phone: "456", description: "Notes" });
    expect(await patch({ phone: "" })).toMatchObject({ phone: null });
    expect(await patch({ description: null })).toMatchObject({ description: null });
  });
});

describe("Backlog and Archive", () => {
  const patch = (tripId: string, eventId: string, body: unknown) => send("PATCH", `/api/trips/${tripId}/events/${eventId}`, body);

  async function board(tripId: string) {
    return z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json()).find((t) => t.id === tripId)!;
  }

  it("creates Events in the Backlog and in the Archive, and lists them in the order they arrived", async () => {
    const { trip } = await createTrip("Kyoto");
    const a = await post(`/api/trips/${trip.id}/backlog/events`, { title: "Philosopher's Path", durationMinutes: 90 });
    await post(`/api/trips/${trip.id}/backlog/events`, { title: "Nara" });
    await post(`/api/trips/${trip.id}/archive/events`, { title: "Too far" });

    expect(a.status).toBe(201);
    expect(eventSchema.parse(await a.json())).toMatchObject({ dayId: null, holding: "backlog", durationMinutes: 90 });
    const listed = await board(trip.id);
    expect(listed.backlog.map((e) => e.title)).toEqual(["Philosopher's Path", "Nara"]);
    expect(listed.archive.map((e) => [e.title, e.holding])).toEqual([["Too far", "archive"]]);
    expect(listed.days[0]!.events).toEqual([]);
  });

  it("needs nights for a Lodging in a holding area, but not a Day to fit them", async () => {
    const { trip } = await createTrip("Kyoto");
    const path = `/api/trips/${trip.id}/backlog/events`;
    expect((await post(path, { title: "Ryokan", kind: "lodging" })).status).toBe(400);
    expect((await post(path, { title: "Ryokan", kind: "lodging", nights: 5 })).status).toBe(201);
  });

  it("returns 404 for an unknown Trip, someone else's Trip, or an unknown area", async () => {
    const { trip } = await createTrip("Kyoto");
    expect((await post(`/api/trips/11111111-1111-4111-8111-111111111111/backlog/events`, { title: "x" })).status).toBe(404);
    expect((await post(`/api/trips/${trip.id}/trash/events`, { title: "x" })).status).toBe(400);
    const [other] = await app.db.insert(users).values({}).returning();
    const [theirs] = await app.db.insert(trips).values({ ownerId: other!.id, title: "Theirs" }).returning();
    expect((await post(`/api/trips/${theirs!.id}/backlog/events`, { title: "x" })).status).toBe(404);
  });

  it("moves an Event from a Day to the Backlog, then the Archive, then back onto a Day, keeping its start time", async () => {
    const { trip, ids } = await tripWithDays(2);
    const created = await post(`/api/trips/${trip.id}/days/${ids[0]}/events`, { title: "Gion", startMinute: 600 });
    const event = eventSchema.parse(await created.json());

    const toBacklog = eventSchema.parse(await (await patch(trip.id, event.id, { area: "backlog" })).json());
    expect(toBacklog).toMatchObject({ dayId: null, holding: "backlog", startMinute: 600 });
    const toArchive = eventSchema.parse(await (await patch(trip.id, event.id, { area: "archive" })).json());
    expect(toArchive).toMatchObject({ dayId: null, holding: "archive" });
    const back = eventSchema.parse(await (await patch(trip.id, event.id, { dayId: ids[1], startMinute: 660 })).json());
    expect(back).toMatchObject({ dayId: ids[1], holding: null, startMinute: 660 });
    const listed = await board(trip.id);
    expect(listed.archive).toEqual([]);
    expect(listed.days[1]!.events.map((e) => e.id)).toEqual([event.id]);
  });

  it("rejects making an Event in a holding area a Lodging without nights", async () => {
    const { trip } = await createTrip("Kyoto");
    const event = eventSchema.parse(await (await post(`/api/trips/${trip.id}/backlog/events`, { title: "Thing" })).json());
    expect((await patch(trip.id, event.id, { kind: "lodging" })).status).toBe(400);
    expect((await patch(trip.id, event.id, { kind: "lodging", nights: 2 })).status).toBe(200);
    expect((await patch(trip.id, event.id, { nights: null })).status).toBe(400);
  });

  it("rejects a change that names both a Day and a holding area", async () => {
    const { trip, ids } = await tripWithDays(1);
    const event = eventSchema.parse(await (await post(`/api/trips/${trip.id}/days/${ids[0]}/events`, { title: "x" })).json());
    expect((await patch(trip.id, event.id, { dayId: ids[0], area: "backlog" })).status).toBe(400);
  });

  it("edits an Event in a holding area without moving it", async () => {
    const { trip } = await createTrip("Kyoto");
    const event = eventSchema.parse(await (await post(`/api/trips/${trip.id}/archive/events`, { title: "Old" })).json());
    const res = await patch(trip.id, event.id, { title: "New", durationMinutes: 30 });
    expect(eventSchema.parse(await res.json())).toMatchObject({ title: "New", holding: "archive", dayId: null, durationMinutes: 30 });
  });

  it("checks that a Lodging fits when it is scheduled from a holding area", async () => {
    const { trip, ids } = await tripWithDays(3);
    const stay = eventSchema.parse(
      await (await post(`/api/trips/${trip.id}/backlog/events`, { title: "Ryokan", kind: "lodging", nights: 3 })).json(),
    );
    expect((await patch(trip.id, stay.id, { dayId: ids[1] })).status).toBe(400); // Days 2 to 4
    expect((await patch(trip.id, stay.id, { dayId: ids[0] })).status).toBe(200);
    // And a Lodging on a Day can go to the Backlog whatever its nights.
    expect((await patch(trip.id, stay.id, { area: "archive" })).status).toBe(200);
  });

  it("does not count a Lodging in a holding area when Days change", async () => {
    const { trip, ids } = await tripWithDays(2);
    await post(`/api/trips/${trip.id}/backlog/events`, { title: "Ryokan", kind: "lodging", nights: 1 });
    expect((await send("DELETE", `/api/trips/${trip.id}/days/${ids[0]}`)).status).toBe(200);
    expect((await post(`/api/trips/${trip.id}/days`, { position: 1 })).status).toBe(201);
    expect((await board(trip.id)).backlog[0]).toMatchObject({ nights: 1, holding: "backlog" });
  });

  it("returns 404 when moving someone else's Event", async () => {
    const [other] = await app.db.insert(users).values({}).returning();
    const [theirs] = await app.db.insert(trips).values({ ownerId: other!.id, title: "Theirs" }).returning();
    const [theirEvent] = await app.db
      .insert(events)
      .values({ tripId: theirs!.id, holding: "backlog", title: "Theirs" })
      .returning();
    expect((await patch(theirs!.id, theirEvent!.id, { area: "archive" })).status).toBe(404);
  });
});

describe("restoring a deleted Day (undo)", () => {
  const restore = (tripId: string, body: unknown) => post(`/api/trips/${tripId}/days/restore`, body);

  async function deleteDay(tripId: string, dayId: string) {
    return dayDeletionSchema.parse(await (await send("DELETE", `/api/trips/${tripId}/days/${dayId}`)).json());
  }

  it("puts the Day back at its position with its Events", async () => {
    const { trip, ids } = await tripWithDays(3);
    const gion = eventSchema.parse(await (await post(`/api/trips/${trip.id}/days/${ids[1]}/events`, { title: "Gion", startMinute: 600 })).json());
    await deleteDay(trip.id, ids[1]!);

    const res = await restore(trip.id, {
      dayId: ids[1],
      position: 2,
      placements: [{ eventId: gion.id, dayId: ids[1], nights: null }],
    });
    const result = dayDeletionSchema.parse(await res.json());

    expect(res.status).toBe(201);
    expect(result.days.map((d) => d.id)).toEqual(ids);
    expect(result.days.map((d) => d.position)).toEqual([1, 2, 3]);
    expect(result.days[1]!.events).toMatchObject([{ id: gion.id, title: "Gion", startMinute: 600, holding: null }]);
    expect(result.backlog).toEqual([]);
  });

  it("gives a stay its nights and check-in Day back", async () => {
    const { trip, ids } = await tripWithDays(5);
    const stay = eventSchema.parse(
      await (await post(`/api/trips/${trip.id}/days/${ids[1]}/events`, { title: "Hotel", kind: "lodging", nights: 3 })).json(),
    );
    await deleteDay(trip.id, ids[1]!); // check-in Day goes: the stay moves to Day 3 with 2 nights

    const result = dayDeletionSchema.parse(
      await (await restore(trip.id, { dayId: ids[1], position: 2, placements: [{ eventId: stay.id, dayId: ids[1], nights: 3 }] })).json(),
    );

    expect(result.days[1]!.events).toMatchObject([{ id: stay.id, nights: 3 }]);
    expect(result.days[2]!.events).toEqual([]);
  });

  it("brings back a stay that had gone to the Backlog", async () => {
    const { trip, ids } = await tripWithDays(3);
    const stay = eventSchema.parse(
      await (await post(`/api/trips/${trip.id}/days/${ids[1]}/events`, { title: "Hotel", kind: "lodging", nights: 1 })).json(),
    );
    await deleteDay(trip.id, ids[1]!);
    const result = dayDeletionSchema.parse(
      await (await restore(trip.id, { dayId: ids[1], position: 2, placements: [{ eventId: stay.id, dayId: ids[1], nights: 1 }] })).json(),
    );
    expect(result.backlog).toEqual([]);
    expect(result.days[1]!.events.map((e) => e.id)).toEqual([stay.id]);
  });

  it("refuses a Day id that exists, a bad position, a Day that is not restored, or an Event of another Trip", async () => {
    const { trip, ids } = await tripWithDays(2);
    const { trip: other } = await createTrip("Other");
    const foreign = eventSchema.parse(await (await post(`/api/trips/${other.id}/backlog/events`, { title: "Theirs" })).json());
    const fresh = "22222222-2222-4222-8222-222222222222";

    expect((await restore(trip.id, { dayId: ids[0], position: 1, placements: [] })).status).toBe(409);
    expect((await restore(trip.id, { dayId: fresh, position: 4, placements: [] })).status).toBe(400);
    expect((await restore(trip.id, { dayId: fresh, position: 1, placements: [{ eventId: foreign.id, dayId: fresh, nights: null }] })).status).toBe(400);
    expect((await restore(trip.id, { dayId: fresh, position: 1, placements: [{ eventId: foreign.id, dayId: ids[0], nights: null }] })).status).toBe(400);
    expect(await positionsOf(trip.id)).toHaveLength(2);
  });

  it("does not bring back an Event that was archived since the deletion", async () => {
    const { trip, ids } = await tripWithDays(2);
    const gion = eventSchema.parse(await (await post(`/api/trips/${trip.id}/days/${ids[1]}/events`, { title: "Gion" })).json());
    await deleteDay(trip.id, ids[1]!);
    await send("PATCH", `/api/trips/${trip.id}/events/${gion.id}`, { area: "archive" });

    const res = await restore(trip.id, { dayId: ids[1], position: 2, placements: [{ eventId: gion.id, dayId: ids[1], nights: null }] });
    const result = dayDeletionSchema.parse(await res.json());

    expect(res.status).toBe(201);
    expect(result.days[1]!.events).toEqual([]);
    const [listed] = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json()).filter((t) => t.id === trip.id);
    expect(listed!.archive.map((e) => e.id)).toEqual([gion.id]);
  });

  it("refuses to put a stay back where its nights no longer fit", async () => {
    const { trip, ids } = await tripWithDays(3);
    const stay = eventSchema.parse(
      await (await post(`/api/trips/${trip.id}/days/${ids[0]}/events`, { title: "Hotel", kind: "lodging", nights: 2 })).json(),
    );
    await deleteDay(trip.id, ids[1]!); // the stay now has 1 night
    await send("PUT", `/api/trips/${trip.id}/days/order`, { dayIds: [ids[2], ids[0]] });

    const res = await restore(trip.id, { dayId: ids[1], position: 2, placements: [{ eventId: stay.id, dayId: ids[0], nights: 2 }] });

    expect(res.status).toBe(400);
    expect(await positionsOf(trip.id)).toHaveLength(2);
  });

  it("returns 404 for someone else's Trip", async () => {
    const [other] = await app.db.insert(users).values({}).returning();
    const [theirs] = await app.db.insert(trips).values({ ownerId: other!.id, title: "Theirs" }).returning();
    const res = await restore(theirs!.id, { dayId: "22222222-2222-4222-8222-222222222222", position: 1, placements: [] });
    expect(res.status).toBe(404);
  });
});

describe("Todos", () => {
  // The user the test app acts as, known once a request has created it.
  let ME = "";
  beforeEach(async () => {
    ME = ((await (await fetch(`${app.baseUrl}/api/me`)).json()) as { id: string }).id;
  });

  async function listedTrip(tripId: string) {
    const all = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json());
    return all.find((t) => t.id === tripId)!;
  }

  async function addTodo(tripId: string, text: string, eventId: string | null = null) {
    const res = await post(`/api/trips/${tripId}/todos`, { text, eventId });
    return { res, body: (await res.json()) as Record<string, unknown> };
  }

  async function eventOn(tripId: string, dayId: string, title = "Kiyomizu-dera") {
    return eventSchema.parse(await (await post(`/api/trips/${tripId}/days/${dayId}/events`, { title })).json());
  }

  it("tells who the current user is", async () => {
    const res = await fetch(`${app.baseUrl}/api/me`);
    expect(await res.json()).toEqual({ id: ME, guest: false });
  });

  it("starts a Trip with no Todos", async () => {
    const { trip } = await createTrip("Kyoto");
    expect(trip.todos).toEqual([]);
  });

  it("adds a Trip Todo and an Event Todo, listed with the Trip", async () => {
    const { trip } = await createTrip("Kyoto");
    const event = await eventOn(trip.id, trip.days[0]!.id);

    const a = await addTodo(trip.id, "  Book Shinkansen seats ");
    const b = await addTodo(trip.id, "Bring coins", event.id);

    expect(a.res.status).toBe(201);
    expect(a.body).toMatchObject({ text: "Book Shinkansen seats", eventId: null, done: false, createdBy: ME });
    expect(b.body).toMatchObject({ eventId: event.id });
    expect((await listedTrip(trip.id)).todos.map((t) => t.text)).toEqual(["Book Shinkansen seats", "Bring coins"]);
  });

  it("rejects blank text", async () => {
    const { trip } = await createTrip("Kyoto");
    expect((await addTodo(trip.id, "   ")).res.status).toBe(400);
  });

  it("refuses a Todo for an Event of another Trip", async () => {
    const { trip } = await createTrip("Kyoto");
    const { trip: other } = await createTrip("Osaka");
    const foreign = await eventOn(other.id, other.days[0]!.id);
    expect((await addTodo(trip.id, "Nope", foreign.id)).res.status).toBe(404);
  });

  it("refuses a Todo for an archived Event", async () => {
    const { trip } = await createTrip("Kyoto");
    const event = await eventOn(trip.id, trip.days[0]!.id);
    await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { area: "archive" });
    expect((await addTodo(trip.id, "Too late", event.id)).res.status).toBe(409);
  });

  it("returns 404 for someone else's Trip", async () => {
    const [other] = await app.db.insert(users).values({}).returning();
    const [theirs] = await app.db.insert(trips).values({ ownerId: other!.id, title: "Theirs" }).returning();
    expect((await addTodo(theirs!.id, "Mine now")).res.status).toBe(404);
  });

  it("does not touch a Todo through another Trip", async () => {
    const { trip } = await createTrip("Kyoto");
    const { trip: other } = await createTrip("Osaka");
    const { body } = await addTodo(trip.id, "Mine");
    const path = `/api/trips/${other.id}/todos/${body.id}`;
    expect((await send("PATCH", path, { done: true })).status).toBe(404);
    expect((await send("DELETE", path)).status).toBe(404);
    expect((await listedTrip(trip.id)).todos).toHaveLength(1);
  });

  it("ticks, renames and deletes a Todo", async () => {
    const { trip } = await createTrip("Kyoto");
    const { body } = await addTodo(trip.id, "Buy ICOCA");
    const path = `/api/trips/${trip.id}/todos/${body.id}`;

    const done = await send("PATCH", path, { done: true });
    expect(await done.json()).toMatchObject({ done: true, text: "Buy ICOCA" });
    const renamed = await send("PATCH", path, { text: "Buy two ICOCA" });
    expect(await renamed.json()).toMatchObject({ done: true, text: "Buy two ICOCA" });
    expect((await send("PATCH", path, {})).status).toBe(400);

    expect((await send("DELETE", path)).status).toBe(204);
    expect((await listedTrip(trip.id)).todos).toEqual([]);
    expect((await send("DELETE", path)).status).toBe(404);
    expect((await send("PATCH", path, { done: false })).status).toBe(404);
  });

  describe("archiving an Event", () => {
    it("deletes that Event's Todos and keeps the others", async () => {
      const { trip } = await createTrip("Kyoto");
      const dayId = trip.days[0]!.id;
      const kiyomizu = await eventOn(trip.id, dayId);
      const gion = await eventOn(trip.id, dayId, "Gion");
      await addTodo(trip.id, "Trip level");
      await addTodo(trip.id, "Gion todo", gion.id);
      await addTodo(trip.id, "Kiyomizu todo", kiyomizu.id);

      await send("PATCH", `/api/trips/${trip.id}/events/${kiyomizu.id}`, { area: "archive" });

      expect((await listedTrip(trip.id)).todos.map((t) => t.text)).toEqual(["Trip level", "Gion todo"]);
    });

    it("does not bring the Todos back when the Event is taken back", async () => {
      const { trip } = await createTrip("Kyoto");
      const event = await eventOn(trip.id, trip.days[0]!.id);
      await addTodo(trip.id, "Book", event.id);
      await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { area: "archive" });
      await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { area: "backlog" });
      expect((await listedTrip(trip.id)).todos).toEqual([]);
    });

    it("keeps the Todos when the Event goes to the Backlog or is edited in the Archive", async () => {
      const { trip } = await createTrip("Kyoto");
      const event = await eventOn(trip.id, trip.days[0]!.id);
      await addTodo(trip.id, "Book", event.id);
      await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { area: "backlog" });
      await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { title: "Renamed" });
      expect((await listedTrip(trip.id)).todos).toHaveLength(1);
    });
  });

  it("keeps an Event's Todos when its Day is deleted and the Event moves to the Backlog", async () => {
    const { trip, ids } = await tripWithDays(2);
    const event = await eventOn(trip.id, ids[1]!);
    await addTodo(trip.id, "Book", event.id);

    await send("DELETE", `/api/trips/${trip.id}/days/${ids[1]}`);

    const listed = await listedTrip(trip.id);
    expect(listed.backlog.map((e) => e.id)).toEqual([event.id]);
    expect(listed.todos.map((t) => t.text)).toEqual(["Book"]);
  });

  describe("deleting an Event", () => {
    it("removes it and its Todos and returns both as they were", async () => {
      const { trip } = await createTrip("Kyoto");
      const event = await eventOn(trip.id, trip.days[0]!.id);
      await addTodo(trip.id, "Trip level");
      await addTodo(trip.id, "Book", event.id);

      const res = await send("DELETE", `/api/trips/${trip.id}/events/${event.id}`);
      const deleted = deletedEventSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(deleted.event).toEqual(event);
      expect(deleted.todos.map((t) => t.text)).toEqual(["Book"]);
      const listed = await listedTrip(trip.id);
      expect(listed.days[0]!.events).toEqual([]);
      expect(listed.todos.map((t) => t.text)).toEqual(["Trip level"]);
    });

    it("deletes an Event in the Backlog or the Archive", async () => {
      const { trip } = await createTrip("Kyoto");
      const event = await eventOn(trip.id, trip.days[0]!.id);
      await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { area: "archive" });
      expect((await send("DELETE", `/api/trips/${trip.id}/events/${event.id}`)).status).toBe(200);
      expect((await listedTrip(trip.id)).archive).toEqual([]);
    });

    it("returns 404 for an unknown Event or someone else's Trip", async () => {
      const { trip } = await createTrip("Kyoto");
      expect((await send("DELETE", `/api/trips/${trip.id}/events/22222222-2222-4222-8222-222222222222`)).status).toBe(404);
      const [other] = await app.db.insert(users).values({}).returning();
      const [theirs] = await app.db.insert(trips).values({ ownerId: other!.id, title: "Theirs" }).returning();
      const [theirEvent] = await app.db.insert(events).values({ tripId: theirs!.id, holding: "backlog", title: "X" }).returning();
      expect((await send("DELETE", `/api/trips/${theirs!.id}/events/${theirEvent!.id}`)).status).toBe(404);
    });
  });

  describe("restoring a deleted Event (undo)", () => {
    const restore = (tripId: string, body: unknown) => post(`/api/trips/${tripId}/events/restore`, body);

    async function deleted(tripId: string, eventId: string) {
      return deletedEventSchema.parse(await (await send("DELETE", `/api/trips/${tripId}/events/${eventId}`)).json());
    }

    it("puts the Event back with the same id, place and Todos", async () => {
      const { trip } = await createTrip("Kyoto");
      const event = await eventOn(trip.id, trip.days[0]!.id);
      await addTodo(trip.id, "Book", event.id);
      const snapshot = await deleted(trip.id, event.id);

      const res = await restore(trip.id, snapshot);

      expect(res.status).toBe(201);
      const listed = await listedTrip(trip.id);
      expect(listed.days[0]!.events).toEqual([event]);
      expect(listed.todos).toEqual(snapshot.todos);
    });

    it("puts a Backlog Event back in the Backlog", async () => {
      const { trip } = await createTrip("Kyoto");
      const event = await eventOn(trip.id, trip.days[0]!.id);
      await send("PATCH", `/api/trips/${trip.id}/events/${event.id}`, { area: "backlog" });
      const snapshot = await deleted(trip.id, event.id);
      await restore(trip.id, snapshot);
      expect((await listedTrip(trip.id)).backlog.map((e) => e.id)).toEqual([event.id]);
    });

    it("puts the Event in the Backlog when its Day is gone", async () => {
      const { trip, ids } = await tripWithDays(2);
      const event = await eventOn(trip.id, ids[1]!);
      await addTodo(trip.id, "Book", event.id);
      const snapshot = await deleted(trip.id, event.id);
      await send("DELETE", `/api/trips/${trip.id}/days/${ids[1]}`);

      const res = await restore(trip.id, snapshot);

      expect(res.status).toBe(201);
      const listed = await listedTrip(trip.id);
      expect(listed.backlog.map((e) => e.id)).toEqual([event.id]);
      expect(listed.todos).toHaveLength(1);
    });

    it("puts a stay in the Backlog when its nights no longer fit", async () => {
      const { trip, ids } = await tripWithDays(2);
      const stay = eventSchema.parse(
        await (await post(`/api/trips/${trip.id}/days/${ids[0]}/events`, { title: "Hotel", kind: "lodging", nights: 2 })).json(),
      );
      const snapshot = await deleted(trip.id, stay.id);
      await send("DELETE", `/api/trips/${trip.id}/days/${ids[1]}`);

      await restore(trip.id, snapshot);

      expect((await listedTrip(trip.id)).backlog.map((e) => e.id)).toEqual([stay.id]);
    });

    it("refuses an Event that already exists", async () => {
      const { trip } = await createTrip("Kyoto");
      const event = await eventOn(trip.id, trip.days[0]!.id);
      const res = await restore(trip.id, { event, todos: [] });
      expect(res.status).toBe(409);
    });

    it("refuses Todos for an archived Event", async () => {
      const { trip } = await createTrip("Kyoto");
      const event = await eventOn(trip.id, trip.days[0]!.id);
      const snapshot = await deleted(trip.id, event.id);
      const todo = { id: "33333333-3333-4333-8333-333333333333", eventId: event.id, text: "x", done: false, createdBy: ME };
      const res = await restore(trip.id, { event: { ...snapshot.event, dayId: null, holding: "archive" }, todos: [todo] });
      expect(res.status).toBe(400);
    });

    it("keeps the order of several Todos", async () => {
      const { trip } = await createTrip("Kyoto");
      const event = await eventOn(trip.id, trip.days[0]!.id);
      for (const text of ["one", "two", "three"]) await addTodo(trip.id, text, event.id);
      const snapshot = await deleted(trip.id, event.id);
      await restore(trip.id, snapshot);
      expect((await listedTrip(trip.id)).todos.map((t) => t.text)).toEqual(["one", "two", "three"]);
    });

    it("refuses Todos that belong to another Event", async () => {
      const { trip } = await createTrip("Kyoto");
      const event = await eventOn(trip.id, trip.days[0]!.id);
      const snapshot = await deleted(trip.id, event.id);
      const stray = { id: "33333333-3333-4333-8333-333333333333", eventId: "44444444-4444-4444-8444-444444444444", text: "x", done: false, createdBy: ME };
      expect((await restore(trip.id, { ...snapshot, todos: [stray] })).status).toBe(400);
      expect((await listedTrip(trip.id)).days[0]!.events).toEqual([]);
    });

    it("returns 404 for someone else's Trip", async () => {
      const { trip } = await createTrip("Kyoto");
      const event = await eventOn(trip.id, trip.days[0]!.id);
      const snapshot = await deleted(trip.id, event.id);
      const [other] = await app.db.insert(users).values({}).returning();
      const [theirs] = await app.db.insert(trips).values({ ownerId: other!.id, title: "Theirs" }).returning();
      expect((await restore(theirs!.id, snapshot)).status).toBe(404);
    });
  });
});

describe("restoring a Day after one of its moved Events was deleted", () => {
  it("restores the Day and the remaining Events", async () => {
    const { trip, ids } = await tripWithDays(2);
    const mk = async (title: string) =>
      eventSchema.parse(await (await post(`/api/trips/${trip.id}/days/${ids[1]}/events`, { title })).json());
    const gion = await mk("Gion");
    const nara = await mk("Nara");
    await send("DELETE", `/api/trips/${trip.id}/days/${ids[1]}`);
    await send("DELETE", `/api/trips/${trip.id}/events/${gion.id}`);

    const res = await post(`/api/trips/${trip.id}/days/restore`, {
      dayId: ids[1],
      position: 2,
      placements: [gion, nara].map((e) => ({ eventId: e.id, dayId: ids[1], nights: null })),
    });

    expect(res.status).toBe(201);
    expect(dayDeletionSchema.parse(await res.json()).days[1]!.events.map((e) => e.id)).toEqual([nara.id]);
  });
});

describe("Notes", () => {
  async function listedNotes(tripId: string) {
    const all = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json());
    return all.find((t) => t.id === tripId)!.notes;
  }

  async function addNote(tripId: string, body: string) {
    const res = await post(`/api/trips/${tripId}/notes`, { body });
    return { res, json: (await res.json()) as unknown };
  }

  it("starts a Trip with no Notes", async () => {
    const { trip } = await createTrip("Kyoto");
    expect(trip.notes).toEqual([]);
  });

  it("adds a Note, unpinned, and lists it with the Trip", async () => {
    const { trip } = await createTrip("Kyoto");
    const { res, json } = await addNote(trip.id, "# Day 1–3 Kyoto\n- Day 4–5 Osaka");
    expect(res.status).toBe(201);
    expect(noteSchema.parse(json)).toMatchObject({ body: "# Day 1–3 Kyoto\n- Day 4–5 Osaka", pinned: false });
    expect(await listedNotes(trip.id)).toEqual([json]);
  });

  it("rejects an empty or too long Note", async () => {
    const { trip } = await createTrip("Kyoto");
    expect((await addNote(trip.id, "  \n ")).res.status).toBe(400);
    expect((await addNote(trip.id, "x".repeat(20001))).res.status).toBe(400);
  });

  it("lists the most recently edited Note first", async () => {
    const { trip } = await createTrip("Kyoto");
    const a = noteSchema.parse((await addNote(trip.id, "first")).json);
    const b = noteSchema.parse((await addNote(trip.id, "second")).json);
    expect((await listedNotes(trip.id)).map((n) => n.id)).toEqual([b.id, a.id]);

    await send("PATCH", `/api/trips/${trip.id}/notes/${a.id}`, { body: "first, edited" });

    expect((await listedNotes(trip.id)).map((n) => n.id)).toEqual([a.id, b.id]);
  });

  it("pins and unpins without counting as an edit", async () => {
    const { trip } = await createTrip("Kyoto");
    const a = noteSchema.parse((await addNote(trip.id, "first")).json);
    await addNote(trip.id, "second");

    const res = await send("PATCH", `/api/trips/${trip.id}/notes/${a.id}`, { pinned: true });
    const pinned = noteSchema.parse(await res.json());

    expect(pinned).toEqual({ ...a, pinned: true });
    expect((await send("PATCH", `/api/trips/${trip.id}/notes/${a.id}`, { pinned: false })).status).toBe(200);
  });

  it("refuses to empty a Note, and an empty change", async () => {
    const { trip } = await createTrip("Kyoto");
    const a = noteSchema.parse((await addNote(trip.id, "first")).json);
    const path = `/api/trips/${trip.id}/notes/${a.id}`;
    expect((await send("PATCH", path, { body: "  " })).status).toBe(400);
    expect((await send("PATCH", path, {})).status).toBe(400);
  });

  it("deletes a Note", async () => {
    const { trip } = await createTrip("Kyoto");
    const a = noteSchema.parse((await addNote(trip.id, "first")).json);
    const path = `/api/trips/${trip.id}/notes/${a.id}`;
    expect((await send("DELETE", path)).status).toBe(204);
    expect(await listedNotes(trip.id)).toEqual([]);
    expect((await send("DELETE", path)).status).toBe(404);
  });

  describe("restoring a deleted Note (undo)", () => {
    const restore = (tripId: string, note: unknown) => post(`/api/trips/${tripId}/notes/restore`, { note });

    it("puts the Note back with its id, pin and edit time, so its place in the list is kept", async () => {
      const { trip } = await createTrip("Kyoto");
      const a = noteSchema.parse((await addNote(trip.id, "first")).json);
      await addNote(trip.id, "second");
      const pinned = noteSchema.parse(await (await send("PATCH", `/api/trips/${trip.id}/notes/${a.id}`, { pinned: true })).json());
      await send("DELETE", `/api/trips/${trip.id}/notes/${a.id}`);

      const res = await restore(trip.id, pinned);

      expect(res.status).toBe(201);
      expect(noteSchema.parse(await res.json())).toEqual(pinned);
      expect((await listedNotes(trip.id)).map((n) => n.id)).toContain(a.id);
      expect((await listedNotes(trip.id)).find((n) => n.id === a.id)).toEqual(pinned);
    });

    it("refuses a Note that already exists, with an empty text, or in someone else's Trip", async () => {
      const { trip } = await createTrip("Kyoto");
      const a = noteSchema.parse((await addNote(trip.id, "first")).json);
      expect((await restore(trip.id, a)).status).toBe(409);
      expect((await restore(trip.id, { ...a, id: "55555555-5555-4555-8555-555555555555", body: " " })).status).toBe(400);
      const [other] = await app.db.insert(users).values({}).returning();
      const [theirs] = await app.db.insert(trips).values({ ownerId: other!.id, title: "Theirs" }).returning();
      expect((await restore(theirs!.id, { ...a, id: "55555555-5555-4555-8555-555555555555" })).status).toBe(404);
    });
  });

  it("does not reach a Note through another Trip", async () => {
    const { trip } = await createTrip("Kyoto");
    const { trip: other } = await createTrip("Osaka");
    const a = noteSchema.parse((await addNote(trip.id, "mine")).json);
    const path = `/api/trips/${other.id}/notes/${a.id}`;
    expect((await send("PATCH", path, { pinned: true })).status).toBe(404);
    expect((await send("DELETE", path)).status).toBe(404);
    expect(await listedNotes(trip.id)).toHaveLength(1);
  });

  it("returns 404 for someone else's Trip", async () => {
    const [other] = await app.db.insert(users).values({}).returning();
    const [theirs] = await app.db.insert(trips).values({ ownerId: other!.id, title: "Theirs" }).returning();
    expect((await addNote(theirs!.id, "Mine now")).res.status).toBe(404);
  });
});

describe("places", () => {
  async function dayOf(tripId: string) {
    const trips = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json());
    return trips.find((t) => t.id === tripId)!.days[0]!.id;
  }

  it("searches places and looks them up by id", async () => {
    const res = await fetch(`${app.baseUrl}/api/places/search?q=nara`);
    const { places } = (await res.json()) as { places: { id: string; name: string }[] };
    expect(places.map((p) => p.name)).toContain("Nara Park");
    const ids = places.map((p) => p.id).slice(0, 2).join(",");
    const looked = (await (await fetch(`${app.baseUrl}/api/places?ids=${encodeURIComponent(ids)}`)).json()) as { places: unknown[] };
    expect(looked.places).toHaveLength(2);
  });

  it("rejects an empty search and too many ids", async () => {
    expect((await fetch(`${app.baseUrl}/api/places/search?q=%20`)).status).toBe(400);
    expect((await fetch(`${app.baseUrl}/api/places?ids=${Array.from({ length: 21 }, (_, i) => `p${i}`).join(",")}`)).status).toBe(400);
  });

  it("keeps a place on an Event, changes it and clears it", async () => {
    const { trip } = await createTrip("Kyoto");
    const dayId = await dayOf(trip.id);
    const created = eventSchema.parse(
      await (await post(`/api/trips/${trip.id}/days/${dayId}/events`, { title: "Visit", placeId: "fake:nara-park" })).json(),
    );
    expect(created.placeId).toBe("fake:nara-park");
    expect(created.destinationId).toBeNull();

    const patch = (body: unknown) =>
      fetch(`${app.baseUrl}/api/trips/${trip.id}/events/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const moved = eventSchema.parse(await (await patch({ placeId: "fake:todai-ji", destinationId: "fake:kyoto-station" })).json());
    expect([moved.placeId, moved.destinationId]).toEqual(["fake:todai-ji", "fake:kyoto-station"]);
    const cleared = eventSchema.parse(await (await patch({ placeId: null, destinationId: null })).json());
    expect([cleared.placeId, cleared.destinationId]).toEqual([null, null]);
  });

  it("refuses a place the provider does not know", async () => {
    const { trip } = await createTrip("Kyoto");
    const dayId = await dayOf(trip.id);
    const res = await post(`/api/trips/${trip.id}/days/${dayId}/events`, { title: "Visit", placeId: "fake:nowhere" });
    expect(res.status).toBe(400);
    const held = await post(`/api/trips/${trip.id}/backlog/events`, { title: "Visit", destinationId: "fake:nowhere" });
    expect(held.status).toBe(400);
  });

  it("refuses an unknown place on an update, and accepts the same place twice", async () => {
    const { trip } = await createTrip("Kyoto");
    const dayId = await dayOf(trip.id);
    const created = eventSchema.parse(await (await post(`/api/trips/${trip.id}/days/${dayId}/events`, { title: "Ferry", kind: "transport" })).json());
    const patch = (body: unknown) =>
      fetch(`${app.baseUrl}/api/trips/${trip.id}/events/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await patch({ placeId: "fake:nowhere" })).status).toBe(400);
    expect((await patch({ destinationId: "fake:nowhere" })).status).toBe(400);
    expect((await patch({ placeId: "fake:nara-park", destinationId: "fake:nara-park" })).status).toBe(200);
  });

  it("answers 404 for a Trip that does not exist before looking up any place", async () => {
    const res = await post(`/api/trips/00000000-0000-4000-8000-000000000999/backlog/events`, { title: "x", placeId: "fake:nara-park" });
    expect(res.status).toBe(404);
  });

  it("brings the place back when a deleted Event is restored", async () => {
    const { trip } = await createTrip("Kyoto");
    const dayId = await dayOf(trip.id);
    const created = eventSchema.parse(
      await (await post(`/api/trips/${trip.id}/days/${dayId}/events`, { title: "Visit", placeId: "fake:nara-park" })).json(),
    );
    const deleted = await (await fetch(`${app.baseUrl}/api/trips/${trip.id}/events/${created.id}`, { method: "DELETE" })).json();
    const restored = eventSchema.parse(await (await post(`/api/trips/${trip.id}/events/restore`, deleted)).json());
    expect(restored.placeId).toBe("fake:nara-park");
  });
});

describe("Trip start date", () => {
  const list = async () => z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json());
  const patchTrip = (id: string, body: unknown) =>
    fetch(`${app.baseUrl}/api/trips/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("has none unless given at creation", async () => {
    expect((await createTrip("Plain")).trip.startDate).toBeNull();
    const dated = tripSchema.parse(await (await post("/api/trips", { title: "Dated", startDate: "2026-11-03" })).json());
    expect(dated.startDate).toBe("2026-11-03");
    expect((await list()).find((t) => t.id === dated.id)?.startDate).toBe("2026-11-03");
  });

  it("is set, changed and cleared", async () => {
    const { trip } = await createTrip("Kyoto");
    expect(await (await patchTrip(trip.id, { startDate: "2026-11-03" })).json()).toEqual({ startDate: "2026-11-03" });
    expect((await list()).find((t) => t.id === trip.id)?.startDate).toBe("2026-11-03");
    await patchTrip(trip.id, { startDate: "2026-12-01" });
    expect((await list()).find((t) => t.id === trip.id)?.startDate).toBe("2026-12-01");
    expect(await (await patchTrip(trip.id, { startDate: null })).json()).toEqual({ startDate: null });
    expect((await list()).find((t) => t.id === trip.id)?.startDate).toBeNull();
  });

  it("refuses a date that does not exist or is not a date, at creation and later", async () => {
    const { trip } = await createTrip("Kyoto");
    for (const startDate of ["2026-02-30", "soon", "", 5]) {
      expect((await patchTrip(trip.id, { startDate })).status, String(startDate)).toBe(400);
    }
    expect((await patchTrip(trip.id, {})).status).toBe(400);
    expect((await post("/api/trips", { title: "x", startDate: "2026-02-30" })).status).toBe(400);
  });

  it("answers 404 for a Trip that is not there", async () => {
    expect((await patchTrip("00000000-0000-4000-8000-000000000000", { startDate: null })).status).toBe(404);
  });
});

describe("opening hours", () => {
  async function eventAt(placeId: string | null, kind: "attraction" | "lodging" = "attraction") {
    const { trip } = await createTrip("Kyoto");
    const dayId = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`)).json()).find((t) => t.id === trip.id)!.days[0]!.id;
    const body = kind === "lodging" ? { title: "Stay", kind, nights: 1, placeId } : { title: "Visit", placeId };
    const event = eventSchema.parse(await (await post(`/api/trips/${trip.id}/days/${dayId}/events`, body)).json());
    return { trip, event, url: `${app.baseUrl}/api/trips/${trip.id}/events/${event.id}` };
  }
  const put = (url: string) => fetch(`${url}/opening-hours`, { method: "PUT" });
  const remove = (url: string) => fetch(`${url}/opening-hours`, { method: "DELETE" });
  const patch = (url: string, body: unknown) =>
    fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("starts off, turns on with the hours, and turns off again", async () => {
    const { event, url } = await eventAt("fake:kinkaku-ji");
    expect(event.openingHoursOn).toBe(false);
    const on = (await (await put(url)).json()) as { event: unknown; hours: { periods: unknown[] } };
    expect(eventSchema.parse(on.event).openingHoursOn).toBe(true);
    expect(on.hours.periods).toHaveLength(7);
    expect(eventSchema.parse(await (await remove(url)).json()).openingHoursOn).toBe(false);
  });

  it("serves the hours of places by id, leaving out places without hours", async () => {
    await eventAt("fake:kinkaku-ji");
    await eventAt("fake:nara-park");
    const res = await fetch(`${app.baseUrl}/api/places/opening-hours?ids=fake:kinkaku-ji,fake:nara-park`);
    const { openingHours } = (await res.json()) as { openingHours: Record<string, unknown> };
    expect(Object.keys(openingHours)).toEqual(["fake:kinkaku-ji"]);
  });

  it("serves hours only for places the user's own Events use", async () => {
    await eventAt("fake:kinkaku-ji");
    const res = await fetch(`${app.baseUrl}/api/places/opening-hours?ids=fake:kinkaku-ji`, { headers: { authorization: "Bearer fake:someone-else" } });
    expect(await res.json()).toEqual({ openingHours: {} });
  });

  it("stays off when the provider has no hours for the place", async () => {
    const { url } = await eventAt("fake:nara-park");
    const answer = (await (await put(url)).json()) as { event: unknown; hours: unknown };
    expect(answer.hours).toBeNull();
    expect(eventSchema.parse(answer.event).openingHoursOn).toBe(false);
  });

  it("refuses an Event without a place or of a kind that has no hours", async () => {
    expect((await put((await eventAt(null)).url)).status).toBe(400);
    expect((await put((await eventAt("fake:granvia-kyoto", "lodging")).url)).status).toBe(400);
  });

  it("answers 404 for an Event that is not there", async () => {
    const { trip } = await eventAt("fake:kinkaku-ji");
    const missing = `${app.baseUrl}/api/trips/${trip.id}/events/00000000-0000-4000-8000-000000000000`;
    expect((await put(missing)).status).toBe(404);
    expect((await remove(missing)).status).toBe(404);
  });

  it("turns off when the place changes or is cleared, and stays on for other changes", async () => {
    const { url } = await eventAt("fake:kinkaku-ji");
    await put(url);
    expect(eventSchema.parse(await (await patch(url, { title: "Golden Pavilion", durationMinutes: 90 })).json()).openingHoursOn).toBe(true);
    expect(eventSchema.parse(await (await patch(url, { placeId: "fake:kinkaku-ji" })).json()).openingHoursOn).toBe(true);
    expect(eventSchema.parse(await (await patch(url, { placeId: "fake:dotonbori" })).json()).openingHoursOn).toBe(false);
    await put(url);
    expect(eventSchema.parse(await (await patch(url, { placeId: null })).json()).openingHoursOn).toBe(false);
  });

  it("keeps the choice when the kind changes", async () => {
    const { url } = await eventAt("fake:kinkaku-ji");
    await put(url);
    const meal = eventSchema.parse(await (await patch(url, { kind: "meal" })).json());
    expect(meal.openingHoursOn).toBe(true);
  });

  it("answers 502 when the provider fails on the button", async () => {
    const failing = await startTestApp({
      ...fakePlaceProvider(),
      getOpeningHours: () => Promise.reject(new PlaceProviderError("Place opening hours failed (503)")),
    });
    try {
      await failing.reset();
      const trip = tripSchema.parse(
        await (await fetch(`${failing.baseUrl}/api/trips`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "T" }) })).json(),
      );
      const event = eventSchema.parse(
        await (
          await fetch(`${failing.baseUrl}/api/trips/${trip.id}/backlog/events`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "x", placeId: "fake:kinkaku-ji" }),
          })
        ).json(),
      );
      expect((await fetch(`${failing.baseUrl}/api/trips/${trip.id}/events/${event.id}/opening-hours`, { method: "PUT" })).status).toBe(502);
    } finally {
      await failing.stop();
    }
  });
});

describe("places when the provider fails", () => {
  it("answers 502 for a search and for saving a place, not 500", async () => {
    const failing = await startTestApp({
      search: () => Promise.reject(new PlaceProviderError("Place search failed (503)")),
      get: () => Promise.reject(new PlaceProviderError("Place lookup failed (503)")),
      getOpeningHours: () => Promise.reject(new PlaceProviderError("Place opening hours failed (503)")),
      getPhoto: () => Promise.reject(new PlaceProviderError("Place photo failed (503)")),
      getPhotoUri: () => Promise.reject(new PlaceProviderError("Place photo failed (503)")),
    });
    try {
      await failing.reset();
      expect((await fetch(`${failing.baseUrl}/api/places/search?q=x`)).status).toBe(502);
      expect((await fetch(`${failing.baseUrl}/api/places?ids=a`)).status).toBe(502);
      const trip = tripSchema.parse(
        await (await fetch(`${failing.baseUrl}/api/trips`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "T" }) })).json(),
      );
      const res = await fetch(`${failing.baseUrl}/api/trips/${trip.id}/backlog/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "x", placeId: "p" }),
      });
      expect(res.status).toBe(502);
    } finally {
      await failing.stop();
    }
  });
});
