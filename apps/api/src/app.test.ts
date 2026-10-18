import { daySchema, eventSchema, healthResponseSchema, tripSchema } from "@travel-planner/shared";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { trips, users, days, events } from "./db/schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test/test-app";

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
    const result = daysSchema.parse(await res.json());

    expect(res.status).toBe(200);
    expect(result.map((d) => d.id)).toEqual([ids[0], ids[2]]);
    expect(result.map((d) => d.position)).toEqual([1, 2]);
  });

  it("refuses to delete a Day that has Events", async () => {
    const { trip, ids } = await tripWithDays(2);
    await post(`/api/trips/${trip.id}/days/${ids[0]}/events`, { title: "Gion" });

    const res = await send("DELETE", `/api/trips/${trip.id}/days/${ids[0]}`);

    expect(res.status).toBe(409);
    expect(await positionsOf(trip.id)).toHaveLength(2);
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

      const remaining = daysSchema.parse(
        (await (await fetch(`${app.baseUrl}/api/trips`)).json()).find((t: { id: string }) => t.id === trip.id)
          .days,
      );
      if (add.status === 201) {
        // The Event exists, so the Day must still exist and the delete must have been refused.
        expect(del.status).toBe(409);
        expect(remaining.flatMap((d) => d.events.map((e) => e.title))).toContain("Race");
      } else {
        expect(add.status).toBe(404);
        expect(del.status).toBe(200);
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
    const [theirEvent] = await app.db.insert(events).values({ dayId: theirDay!.id, title: "Theirs" }).returning();
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
      const stillThere = listed.find((t) => t.id === trip.id)!.days.flatMap((d) => d.events);
      // The Event is never lost: either the move won (and the delete was refused) or the delete won.
      expect(stillThere.map((e) => e.id)).toEqual([event.id]);
      if (move.status === 200) expect(del.status).toBe(409);
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

    it("refuses to delete a Day that would leave a stay with no nights", async () => {
      const { trip, ids } = await tripWithDays(3);
      await stay(trip.id, ids[1]!, 1);
      const res = await remove(trip.id, ids[1]!);
      expect(res.status).toBe(409);
      expect(await lodgingOf(trip.id)).toMatchObject({ position: 2, nights: 1 });
      expect(await positionsOf(trip.id)).toHaveLength(3);
    });

    it("still refuses a Day that has another Event, but not one that only holds a check-in", async () => {
      const { trip, ids } = await setup();
      await post(`/api/trips/${trip.id}/days/${ids[2]!}/events`, { title: "Castle" });
      expect((await remove(trip.id, ids[2]!)).status).toBe(409);
      expect((await remove(trip.id, ids[1]!)).status).toBe(200); // only the stay's check-in
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
