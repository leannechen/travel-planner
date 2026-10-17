import { eventSchema, healthResponseSchema, tripSchema } from "@travel-planner/shared";
import { z } from "zod";
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
});
