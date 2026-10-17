import { daySchema, eventSchema, healthResponseSchema, tripSchema } from "@travel-planner/shared";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { trips, users, days } from "./db/schema";
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

function send(method: "PUT" | "DELETE", path: string, body?: unknown) {
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
    expect((await positionsOf(trip.id)).map((d) => d.position)).toEqual([1, 2, 3, 4]);
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
