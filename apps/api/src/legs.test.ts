import { eventSchema, legSchema, tripSchema, type Leg, type TravelMode } from "@travel-planner/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApp } from "../test/test-app";
import { fakePlaceProvider } from "./places";
import { fakeRouteProvider, googleRouteProvider, ROUTE_CACHE_DAYS, RouteProviderError, type RouteProvider } from "./routes";

// A route provider that counts its lookups and can be made to fail.
const inner = fakeRouteProvider();
const calls = { estimate: 0 };
let failing = false;
// While set, lookups wait for it: a slow provider.
let gate: Promise<void> | undefined;
const routes: RouteProvider = {
  async estimate(from, to, mode) {
    calls.estimate++;
    await gate;
    if (failing) throw new RouteProviderError("down");
    return inner.estimate(from, to, mode);
  },
};

let app: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  app = await startTestApp(fakePlaceProvider(), routes);
});
beforeEach(async () => {
  await app.reset();
  calls.estimate = 0;
  failing = false;
  gate = undefined;
});
afterAll(() => app.stop());

const url = (path: string) => `${app.baseUrl}${path}`;
const send = (method: string, path: string, body?: unknown) =>
  fetch(url(path), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const FUSHIMI = "fake:fushimi-inari";
const KINKAKU = "fake:kinkaku-ji";
const NISHIKI = "fake:nishiki-market";

async function newTrip() {
  const trip = tripSchema.parse(await (await send("POST", "/api/trips", { title: "Kyoto" })).json());
  return { tripId: trip.id, dayId: trip.days[0]!.id };
}

async function addEvent(tripId: string, dayId: string, fields: Record<string, unknown>) {
  const res = await send("POST", `/api/trips/${tripId}/days/${dayId}/events`, { title: "Event", durationMinutes: 60, ...fields });
  expect(res.status).toBe(201);
  return eventSchema.parse(await res.json());
}

async function legsOf(tripId: string): Promise<Leg[]> {
  return legSchema.array().parse(await (await send("GET", `/api/trips/${tripId}/legs`)).json());
}

// Two Events one after the other, each with a place, and the Leg between them.
async function tripWithLeg(mode: TravelMode = "walk") {
  const { tripId, dayId } = await newTrip();
  const a = await addEvent(tripId, dayId, { title: "A", startMinute: 540, placeId: FUSHIMI });
  const b = await addEvent(tripId, dayId, { title: "B", startMinute: 720, placeId: KINKAKU });
  const res = await send("POST", `/api/trips/${tripId}/legs`, { fromEventId: a.id, toEventId: b.id, mode });
  return { tripId, dayId, a, b, res, leg: res.status === 201 ? legSchema.parse(await res.clone().json()) : undefined };
}

describe("creating a Leg", () => {
  it("calculates the duration and the distance between the two places", async () => {
    const { res, leg, dayId, a, b } = await tripWithLeg("walk");
    expect(res.status).toBe(201);
    expect(leg).toMatchObject({ dayId, fromEventId: a.id, toEventId: b.id, mode: "walk" });
    expect(leg!.durationMinutes).toBeGreaterThan(0);
    expect(leg!.distanceMeters).toBeGreaterThan(1000);
  });

  it("is longer on foot than by car", async () => {
    const walk = (await tripWithLeg("walk")).leg!;
    await app.reset();
    const drive = (await tripWithLeg("drive")).leg!;
    expect(walk.durationMinutes!).toBeGreaterThan(drive.durationMinutes!);
  });

  it("is listed with the Trip", async () => {
    const { tripId, leg } = await tripWithLeg();
    const trips = tripSchema.array().parse(await (await send("GET", "/api/trips")).json());
    expect(trips[0]!.legs).toEqual([leg]);
    expect(trips[0]!.travelMode).toBe("transit");
    expect(await legsOf(tripId)).toEqual([leg]);
  });

  it("needs a location on both Events", async () => {
    const { tripId, dayId } = await newTrip();
    const a = await addEvent(tripId, dayId, { startMinute: 540, placeId: FUSHIMI });
    const b = await addEvent(tripId, dayId, { startMinute: 720 });
    const res = await send("POST", `/api/trips/${tripId}/legs`, { fromEventId: a.id, toEventId: b.id, mode: "drive" });
    expect(res.status).toBe(400);
    expect(await legsOf(tripId)).toEqual([]);
    expect(calls.estimate).toBe(0);
  });

  it("refuses Events that are not next to each other, a second Leg for a pair and unknown Trips", async () => {
    const { tripId, dayId, a, b } = await tripWithLeg();
    const c = await addEvent(tripId, dayId, { startMinute: 900, placeId: NISHIKI });
    expect((await send("POST", `/api/trips/${tripId}/legs`, { fromEventId: a.id, toEventId: c.id, mode: "walk" })).status).toBe(400);
    expect((await send("POST", `/api/trips/${tripId}/legs`, { fromEventId: b.id, toEventId: a.id, mode: "walk" })).status).toBe(400);
    expect((await send("POST", `/api/trips/${tripId}/legs`, { fromEventId: a.id, toEventId: b.id, mode: "walk" })).status).toBe(409);
    expect((await send("POST", `/api/trips/${crypto.randomUUID()}/legs`, { fromEventId: a.id, toEventId: b.id, mode: "walk" })).status).toBe(404);
  });

  it("refuses Events that overlap, Events in different Days and Lodging", async () => {
    const { tripId, dayId } = await newTrip();
    const a = await addEvent(tripId, dayId, { startMinute: 540, durationMinutes: 120 });
    const b = await addEvent(tripId, dayId, { startMinute: 600 });
    const lodging = await addEvent(tripId, dayId, { kind: "lodging", nights: 1, startMinute: 1200 });
    const legBody = (from: string, to: string) => ({ fromEventId: from, toEventId: to, mode: "walk" });
    expect((await send("POST", `/api/trips/${tripId}/legs`, legBody(a.id, b.id))).status).toBe(400);
    expect((await send("POST", `/api/trips/${tripId}/legs`, legBody(b.id, lodging.id))).status).toBe(400);
    const day2 = (await (await send("POST", `/api/trips/${tripId}/days`, { position: 2 })).json()) as { id: string }[];
    const other = await addEvent(tripId, day2[1]!.id, { startMinute: 700 });
    expect((await send("POST", `/api/trips/${tripId}/legs`, legBody(b.id, other.id))).status).toBe(400);
  });

  it("answers 502 when travel times are not available", async () => {
    const { tripId, dayId } = await newTrip();
    const a = await addEvent(tripId, dayId, { startMinute: 540, placeId: FUSHIMI });
    const b = await addEvent(tripId, dayId, { startMinute: 720, placeId: KINKAKU });
    failing = true;
    const res = await send("POST", `/api/trips/${tripId}/legs`, { fromEventId: a.id, toEventId: b.id, mode: "walk" });
    expect(res.status).toBe(502);
    expect(await legsOf(tripId)).toEqual([]);
  });

  it("asks the provider once for the same pair and mode", async () => {
    const first = await tripWithLeg("walk");
    await send("DELETE", `/api/trips/${first.tripId}/legs/${first.leg!.id}`);
    await send("POST", `/api/trips/${first.tripId}/legs`, { fromEventId: first.a.id, toEventId: first.b.id, mode: "walk" });
    expect(calls.estimate).toBe(1);
  });
});

describe("a Transport event between two Events", () => {
  it("leaves from its destination and arrives at its departure place", async () => {
    const { tripId, dayId } = await newTrip();
    const a = await addEvent(tripId, dayId, { startMinute: 540, placeId: FUSHIMI });
    const ferry = await addEvent(tripId, dayId, { kind: "transport", startMinute: 600, durationMinutes: 60, placeId: KINKAKU, destinationId: NISHIKI });
    const c = await addEvent(tripId, dayId, { startMinute: 720, placeId: FUSHIMI });
    const first = legSchema.parse(await (await send("POST", `/api/trips/${tripId}/legs`, { fromEventId: a.id, toEventId: ferry.id, mode: "walk" })).json());
    const second = legSchema.parse(await (await send("POST", `/api/trips/${tripId}/legs`, { fromEventId: ferry.id, toEventId: c.id, mode: "walk" })).json());
    // Fushimi to the departure place (Kinkaku-ji), then from the destination (Nishiki) to Fushimi.
    const walk = fakeRouteProvider();
    const places = fakePlaceProvider();
    const [fushimi, kinkaku, nishiki] = await Promise.all([FUSHIMI, KINKAKU, NISHIKI].map((id) => places.get(id)));
    expect(first.durationMinutes).toBe((await walk.estimate(fushimi!, kinkaku!, "walk"))!.durationMinutes);
    expect(second.durationMinutes).toBe((await walk.estimate(nishiki!, fushimi!, "walk"))!.durationMinutes);
  });
});

describe("changing a Leg", () => {
  it("changes the travel mode and calculates the Leg again", async () => {
    const { tripId, leg } = await tripWithLeg("walk");
    const res = await send("PATCH", `/api/trips/${tripId}/legs/${leg!.id}`, { mode: "drive" });
    const changed = legSchema.parse(await res.json());
    expect(changed.mode).toBe("drive");
    expect(changed.durationMinutes!).toBeLessThan(leg!.durationMinutes!);
  });

  it("deletes a Leg, and answers 404 for one that is gone", async () => {
    const { tripId, leg } = await tripWithLeg();
    expect((await send("DELETE", `/api/trips/${tripId}/legs/${leg!.id}`)).status).toBe(204);
    expect(await legsOf(tripId)).toEqual([]);
    expect((await send("DELETE", `/api/trips/${tripId}/legs/${leg!.id}`)).status).toBe(404);
    expect((await send("PATCH", `/api/trips/${tripId}/legs/${leg!.id}`, { mode: "walk" })).status).toBe(404);
  });

  it("does not touch the Leg of another Trip", async () => {
    const { leg } = await tripWithLeg();
    const other = await newTrip();
    expect((await send("DELETE", `/api/trips/${other.tripId}/legs/${leg!.id}`)).status).toBe(404);
    expect((await send("PATCH", `/api/trips/${other.tripId}/legs/${leg!.id}`, { mode: "drive" })).status).toBe(404);
  });

  it("answers 502 when the new mode cannot be calculated, and keeps the Leg as it was", async () => {
    const { tripId, leg } = await tripWithLeg("walk");
    failing = true;
    expect((await send("PATCH", `/api/trips/${tripId}/legs/${leg!.id}`, { mode: "drive" })).status).toBe(502);
    expect(await legsOf(tripId)).toEqual([leg]);
  });
});

describe("Leg lifecycle (PRD §3.3)", () => {
  it("removes the Leg when another Event is inserted between the two", async () => {
    const { tripId, dayId, leg } = await tripWithLeg();
    await addEvent(tripId, dayId, { startMinute: 630 });
    expect(await legsOf(tripId)).toEqual([]);
    expect(leg).toBeDefined();
  });

  it("removes the Leg when an Event is moved so they are no longer adjacent", async () => {
    const { tripId, a } = await tripWithLeg();
    await send("PATCH", `/api/trips/${tripId}/events/${a.id}`, { startMinute: 800 });
    expect(await legsOf(tripId)).toEqual([]);
  });

  it("keeps the Leg when an Event moves but stays adjacent", async () => {
    const { tripId, a, leg } = await tripWithLeg();
    await send("PATCH", `/api/trips/${tripId}/events/${a.id}`, { startMinute: 500 });
    expect(await legsOf(tripId)).toEqual([leg]);
  });

  it("removes the Leg when an Event goes to the Backlog or the Archive, or is deleted", async () => {
    for (const change of [
      (tripId: string, id: string) => send("PATCH", `/api/trips/${tripId}/events/${id}`, { area: "backlog" }),
      (tripId: string, id: string) => send("PATCH", `/api/trips/${tripId}/events/${id}`, { area: "archive" }),
      (tripId: string, id: string) => send("DELETE", `/api/trips/${tripId}/events/${id}`),
    ]) {
      await app.reset();
      const { tripId, b } = await tripWithLeg();
      expect((await change(tripId, b.id)).ok).toBe(true);
      expect(await legsOf(tripId)).toEqual([]);
    }
  });

  it("removes the Leg when an Event moves to another Day", async () => {
    const { tripId, a } = await tripWithLeg();
    const day2 = (await (await send("POST", `/api/trips/${tripId}/days`, { position: 2 })).json()) as { id: string }[];
    await send("PATCH", `/api/trips/${tripId}/events/${a.id}`, { dayId: day2[1]!.id });
    expect(await legsOf(tripId)).toEqual([]);
  });

  it("removes the Legs of a deleted Day", async () => {
    const { tripId, dayId } = await tripWithLeg();
    await send("POST", `/api/trips/${tripId}/days`, { position: 2 });
    expect((await send("DELETE", `/api/trips/${tripId}/days/${dayId}`)).ok).toBe(true);
    expect(await legsOf(tripId)).toEqual([]);
  });

  it("calculates the Leg again when an Event's place changes", async () => {
    const { tripId, a, leg } = await tripWithLeg("walk");
    await send("PATCH", `/api/trips/${tripId}/events/${a.id}`, { placeId: NISHIKI });
    const [changed] = await legsOf(tripId);
    expect(changed!.id).toBe(leg!.id);
    expect(changed!.durationMinutes).not.toBe(leg!.durationMinutes);
    expect(changed!.durationMinutes).not.toBeNull();
  });

  it("keeps the Leg but marks it as not calculable when a place is cleared, and recovers when it is set again", async () => {
    const { tripId, b, leg } = await tripWithLeg();
    await send("PATCH", `/api/trips/${tripId}/events/${b.id}`, { placeId: null });
    expect(await legsOf(tripId)).toEqual([{ ...leg, durationMinutes: null, distanceMeters: null }]);
    await send("PATCH", `/api/trips/${tripId}/events/${b.id}`, { placeId: KINKAKU });
    expect(await legsOf(tripId)).toEqual([leg]);
  });

  it("does not ask the provider again when something else about an Event changes", async () => {
    const { tripId, a } = await tripWithLeg();
    const before = calls.estimate;
    await send("PATCH", `/api/trips/${tripId}/events/${a.id}`, { title: "Renamed" });
    expect(calls.estimate).toBe(before);
  });

  it("shows the Leg as not calculable when the provider fails, and tries again at the next change", async () => {
    const { tripId, a, b, leg } = await tripWithLeg("walk");
    failing = true;
    const res = await send("PATCH", `/api/trips/${tripId}/events/${a.id}`, { placeId: NISHIKI });
    expect(res.status).toBe(200);
    expect(await legsOf(tripId)).toEqual([{ ...leg, durationMinutes: null, distanceMeters: null }]);
    failing = false;
    await send("PATCH", `/api/trips/${tripId}/events/${b.id}`, { title: "Renamed" });
    const [again] = await legsOf(tripId);
    expect(again!.durationMinutes).not.toBeNull();
  });
});

describe("Legs and failures of the provider", () => {
  it("does not stay stuck on 'cannot calculate' when the place is put back after a failure", async () => {
    const { tripId, a, leg } = await tripWithLeg("walk");
    failing = true;
    await send("PATCH", `/api/trips/${tripId}/events/${a.id}`, { placeId: "fake:dotonbori" });
    expect((await legsOf(tripId))[0]!.durationMinutes).toBeNull();
    // Back to the first place: its travel time is in the cache, so no provider is needed.
    await send("PATCH", `/api/trips/${tripId}/events/${a.id}`, { placeId: FUSHIMI });
    expect(await legsOf(tripId)).toEqual([leg]);
  });

  it("calculates a new mode from where the Events are now, not from where they were", async () => {
    const { tripId, a, leg } = await tripWithLeg("walk");
    failing = true;
    await send("PATCH", `/api/trips/${tripId}/events/${a.id}`, { placeId: NISHIKI });
    failing = false;
    const res = await send("PATCH", `/api/trips/${tripId}/legs/${leg!.id}`, { mode: "walk" });
    const places = fakePlaceProvider();
    const [nishiki, kinkaku] = await Promise.all([NISHIKI, KINKAKU].map((id) => places.get(id)));
    const expected = (await fakeRouteProvider().estimate(nishiki!, kinkaku!, "walk"))!.durationMinutes;
    expect(legSchema.parse(await res.json()).durationMinutes).toBe(expected);
  });
});

describe("creating a Leg while Events change", () => {
  it("does not leave a Leg between Events that stopped being adjacent during the calculation", async () => {
    const { tripId, dayId } = await newTrip();
    const a = await addEvent(tripId, dayId, { startMinute: 540, placeId: FUSHIMI });
    const b = await addEvent(tripId, dayId, { startMinute: 720, placeId: KINKAKU });
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    const creating = send("POST", `/api/trips/${tripId}/legs`, { fromEventId: a.id, toEventId: b.id, mode: "walk" });
    // An Event lands between the two while the provider is still answering.
    await vi.waitFor(() => expect(calls.estimate).toBe(1));
    await addEvent(tripId, dayId, { startMinute: 630 });
    release();
    expect((await creating).status).toBe(400);
    expect(await legsOf(tripId)).toEqual([]);
  });
});

describe("Legs and Days", () => {
  it("keeps Legs when Days are inserted or reordered", async () => {
    const { tripId, leg } = await tripWithLeg();
    const days = (await (await send("POST", `/api/trips/${tripId}/days`, { position: 1 })).json()) as { id: string }[];
    expect(await legsOf(tripId)).toEqual([leg]);
    await send("PUT", `/api/trips/${tripId}/days/order`, { dayIds: [...days.map((d) => d.id)].reverse() });
    expect(await legsOf(tripId)).toEqual([leg]);
  });

  it("does not bring a Leg back when a deleted Event or Day is restored", async () => {
    const { tripId, a } = await tripWithLeg();
    const deleted = await (await send("DELETE", `/api/trips/${tripId}/events/${a.id}`)).json();
    expect((await send("POST", `/api/trips/${tripId}/events/restore`, deleted)).status).toBe(201);
    expect(await legsOf(tripId)).toEqual([]);
  });
});

describe("a Trip's travel mode", () => {
  it("is transit unless chosen, and can be chosen when the Trip is created", async () => {
    const plain = tripSchema.parse(await (await send("POST", "/api/trips", { title: "A" })).json());
    const walking = tripSchema.parse(await (await send("POST", "/api/trips", { title: "B", travelMode: "walk" })).json());
    expect([plain.travelMode, walking.travelMode]).toEqual(["transit", "walk"]);
    expect((await send("POST", "/api/trips", { title: "C", travelMode: "boat" })).status).toBe(400);
  });
});

describe("fake route provider", () => {
  it("gives longer times for longer distances and never less than a minute", async () => {
    const places = fakePlaceProvider();
    const [fushimi, kinkaku] = await Promise.all([FUSHIMI, KINKAKU].map((id) => places.get(id)));
    const far = await fakeRouteProvider().estimate(fushimi!, kinkaku!, "drive");
    const near = await fakeRouteProvider().estimate(fushimi!, fushimi!, "drive");
    expect(far!.durationMinutes).toBeGreaterThan(near!.durationMinutes);
    expect(near!.durationMinutes).toBe(1);
  });
});

describe("Google route provider", () => {
  const from = { id: "a", name: "A", address: "", lat: 35.1, lng: 135.2 };
  const to = { id: "b", name: "B", address: "", lat: 35.3, lng: 135.4 };
  const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("asks for the duration and distance only, between the two points, by the mode", async () => {
    const fetchFn = answer({ routes: [{ duration: "1165s", distanceMeters: 7400 }] });
    const found = await googleRouteProvider("KEY", fetchFn as unknown as typeof fetch).estimate(from, to, "transit");
    expect(found).toEqual({ durationMinutes: 19, distanceMeters: 7400 });
    const [requested, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(requested).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(init.headers).toMatchObject({ "X-Goog-Api-Key": "KEY", "X-Goog-FieldMask": "routes.duration,routes.distanceMeters" });
    expect(JSON.parse(init.body as string)).toEqual({
      origin: { location: { latLng: { latitude: 35.1, longitude: 135.2 } } },
      destination: { location: { latLng: { latitude: 35.3, longitude: 135.4 } } },
      travelMode: "TRANSIT",
    });
  });

  it("sends the other modes by their Google names", async () => {
    const fetchFn = answer({ routes: [{ duration: "60s" }] });
    const provider = googleRouteProvider("KEY", fetchFn as unknown as typeof fetch);
    await provider.estimate(from, to, "drive");
    await provider.estimate(from, to, "walk");
    const modes = fetchFn.mock.calls.map((c) => JSON.parse(((c as unknown as [string, RequestInit])[1].body as string)).travelMode);
    expect(modes).toEqual(["DRIVE", "WALK"]);
  });

  it("treats an answer without routes as no route", async () => {
    expect(await googleRouteProvider("KEY", answer({}) as unknown as typeof fetch).estimate(from, to, "transit")).toBeUndefined();
  });

  it("fails with RouteProviderError for errors, timeouts and answers it cannot read", async () => {
    const broken = [
      answer({ error: "denied" }, 403),
      vi.fn(async () => {
        throw new Error("network down");
      }),
      answer({ routes: [{ duration: "soon" }] }),
      vi.fn(async () => new Response("not json", { status: 200 })),
    ];
    for (const fetchFn of broken) {
      await expect(googleRouteProvider("KEY", fetchFn as unknown as typeof fetch).estimate(from, to, "walk")).rejects.toBeInstanceOf(RouteProviderError);
    }
  });
});

describe("the route cache", () => {
  it("is used for a pair younger than the cache time and refreshed after it", async () => {
    const { routeBetween } = await import("./routes");
    const places = fakePlaceProvider();
    const [fushimi, kinkaku] = await Promise.all([FUSHIMI, KINKAKU].map((id) => places.get(id)));
    const now = new Date("2026-01-01T00:00:00Z");
    await routeBetween(app.db, routes, fushimi!, kinkaku!, "walk", now);
    await routeBetween(app.db, routes, fushimi!, kinkaku!, "walk", new Date(now.getTime() + (ROUTE_CACHE_DAYS - 1) * 86400000));
    expect(calls.estimate).toBe(1);
    await routeBetween(app.db, routes, fushimi!, kinkaku!, "walk", new Date(now.getTime() + (ROUTE_CACHE_DAYS + 1) * 86400000));
    expect(calls.estimate).toBe(2);
  });

  it("remembers that there is no route", async () => {
    const { routeBetween } = await import("./routes");
    const none: RouteProvider = { estimate: vi.fn(async () => undefined) };
    const places = fakePlaceProvider();
    const [fushimi, kinkaku] = await Promise.all([FUSHIMI, KINKAKU].map((id) => places.get(id)));
    expect(await routeBetween(app.db, none, fushimi!, kinkaku!, "transit")).toBeUndefined();
    expect(await routeBetween(app.db, none, fushimi!, kinkaku!, "transit")).toBeUndefined();
    expect(none.estimate).toHaveBeenCalledTimes(1);
  });
});
