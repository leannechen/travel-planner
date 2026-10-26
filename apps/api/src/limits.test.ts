import { eventSchema, MAX_SEED_DAYS, MAX_SEED_EVENTS, MAX_SEED_NOTES, MAX_SEED_TODOS, MAX_TRIPS, tripSchema } from "@travel-planner/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test/test-app";
import { days, events, notes, todos, trips, usageCounts } from "./db/schema";

// The sizes the live write routes keep to: the same per-Trip numbers a backup import is held to, and
// a number of Trips for each user. Each test fills a Trip to its limit straight in the database, and
// tries one more through the API.

let app: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(() => app.reset());
afterAll(() => app.stop());

const ACCOUNT = { authorization: "Bearer fake:lena@example.com" };

const send = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  fetch(`${app.baseUrl}${path}`, { method, headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });

async function tripOf(headers: Record<string, string>) {
  const trip = tripSchema.parse(await (await send("POST", "/api/trips", headers, { title: "Kyoto" })).json());
  const me = z.object({ id: z.string() }).parse(await (await send("GET", "/api/me", headers)).json());
  return { trip, userId: me.id };
}

async function eventIn(headers: Record<string, string>, trip: { id: string; days: { id: string }[] }) {
  return eventSchema.parse(await (await send("POST", `/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, headers, { title: "Base" })).json());
}

const full = async (res: Response) => {
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ code: "limit_reached" });
};

describe("how big a Trip can get", () => {
  it("stops a Day past the limit, and a restored Day too", async () => {
    const { trip } = await tripOf(ACCOUNT);
    await app.db.insert(days).values(Array.from({ length: MAX_SEED_DAYS - 2 }, (_, i) => ({ tripId: trip.id, position: i + 2 })));
    expect((await send("POST", `/api/trips/${trip.id}/days`, ACCOUNT, { position: 1 })).status).toBe(201);
    await full(await send("POST", `/api/trips/${trip.id}/days`, ACCOUNT, { position: 1 }));
    await full(await send("POST", `/api/trips/${trip.id}/days/restore`, ACCOUNT, { dayId: crypto.randomUUID(), position: 1, placements: [] }));
  });

  it("stops an Event past the limit, on a Day or in a holding area, and a restored Event too", async () => {
    const { trip } = await tripOf(ACCOUNT);
    const base = await eventIn(ACCOUNT, trip);
    await app.db.insert(events).values(Array.from({ length: MAX_SEED_EVENTS - 1 }, (_, i) => ({ tripId: trip.id, holding: "backlog" as const, title: `Stop ${i}` })));
    await full(await send("POST", `/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, ACCOUNT, { title: "One more" }));
    await full(await send("POST", `/api/trips/${trip.id}/backlog/events`, ACCOUNT, { title: "One more" }));
    await full(await send("POST", `/api/trips/${trip.id}/events/restore`, ACCOUNT, { event: { ...base, id: crypto.randomUUID(), dayId: null, holding: "backlog" }, todos: [] }));
  });

  it("stops a Todo and a Note past the limit", async () => {
    const { trip, userId } = await tripOf(ACCOUNT);
    await app.db.insert(todos).values(Array.from({ length: MAX_SEED_TODOS }, (_, i) => ({ tripId: trip.id, text: `Todo ${i}`, createdBy: userId })));
    await app.db.insert(notes).values(Array.from({ length: MAX_SEED_NOTES }, (_, i) => ({ tripId: trip.id, body: `Note ${i}` })));
    await full(await send("POST", `/api/trips/${trip.id}/todos`, ACCOUNT, { text: "One more", eventId: null }));
    await full(await send("POST", `/api/trips/${trip.id}/notes`, ACCOUNT, { body: "One more" }));
    await full(await send("POST", `/api/trips/${trip.id}/notes/restore`, ACCOUNT, { note: { id: crypto.randomUUID(), body: "Back", pinned: false, updatedAt: new Date().toISOString() } }));
  });

  it("counts Todos that come back with a restored Event", async () => {
    const { trip, userId } = await tripOf(ACCOUNT);
    const base = await eventIn(ACCOUNT, trip);
    await app.db.insert(todos).values(Array.from({ length: MAX_SEED_TODOS - 1 }, (_, i) => ({ tripId: trip.id, text: `Todo ${i}`, createdBy: userId })));
    const eventId = crypto.randomUUID();
    const todo = (n: number) => ({ id: crypto.randomUUID(), eventId, text: `Back ${n}`, done: false, createdBy: userId, createdAt: new Date().toISOString() });
    await full(await send("POST", `/api/trips/${trip.id}/events/restore`, ACCOUNT, { event: { ...base, id: eventId, dayId: null, holding: "backlog" }, todos: [todo(1), todo(2)] }));
    expect(await app.db.select().from(events).where(eq(events.id, eventId))).toHaveLength(0);
  });
});

describe("Days and Notes written at the same moment", () => {
  it("do not wait on each other forever", async () => {
    const { trip } = await tripOf(ACCOUNT);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        i % 2 === 0 ? send("POST", `/api/trips/${trip.id}/days`, ACCOUNT, { position: 1 }) : send("POST", `/api/trips/${trip.id}/notes`, ACCOUNT, { body: `Note ${i}` }),
      ),
    );
    expect(results.map((r) => r.status).filter((s) => s >= 500)).toEqual([]);
  });
});

describe("how many Trips a user can have", () => {
  it("stops a guest at the guest limit, and an account at the account limit", async () => {
    const guest = { "x-guest-id": crypto.randomUUID() };
    for (let i = 0; i < MAX_TRIPS.guest; i++) expect((await send("POST", "/api/trips", guest, { title: `Trip ${i}` })).status).toBe(201);
    await full(await send("POST", "/api/trips", guest, { title: "One more" }));

    const { userId } = await tripOf(ACCOUNT);
    await app.db.insert(trips).values(Array.from({ length: MAX_TRIPS.account - 1 }, (_, i) => ({ ownerId: userId, title: `Trip ${i}` })));
    await full(await send("POST", "/api/trips", ACCOUNT, { title: "One more" }));
  });

  it("refuses an AI generation and a backup import before any work, when there is no room for the Trip", async () => {
    const { userId } = await tripOf(ACCOUNT);
    await app.db.insert(trips).values(Array.from({ length: MAX_TRIPS.account - 1 }, (_, i) => ({ ownerId: userId, title: `Trip ${i}` })));
    await full(await send("POST", "/api/generations", ACCOUNT, { prompt: "Three days in Kyoto", language: "en" }));
    await full(await send("POST", "/api/trips/import", ACCOUNT, { not: "read" }));
    // Neither took anything from today's shares.
    expect(await app.db.select().from(usageCounts)).toHaveLength(0);
  });

  it("applies to the sample Trip as well", async () => {
    const { userId } = await tripOf(ACCOUNT);
    await app.db.insert(trips).values(Array.from({ length: MAX_TRIPS.account - 1 }, (_, i) => ({ ownerId: userId, title: `Trip ${i}` })));
    await full(await send("POST", "/api/sample-trip", ACCOUNT));
  });
});
