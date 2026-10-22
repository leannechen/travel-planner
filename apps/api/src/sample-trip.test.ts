import { sampleTripResponseSchema, tripSchema } from "@travel-planner/shared";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp, testToken } from "../test/test-app";
import { fakePlaceProvider, PlaceProviderError } from "./places";
import { SAMPLE_PLACES, sampleStartDate } from "./sample-trip";

let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(() => app.reset());
afterAll(() => app.stop());

const account = { authorization: `Bearer ${testToken("auth0|lena")}` };
const guest = () => ({ "x-guest-id": crypto.randomUUID() });
type Headers = Record<string, string>;

const openSample = async (headers: Headers) => {
  const res = await fetch(`${app.baseUrl}/api/sample-trip`, { method: "POST", headers });
  return { status: res.status, body: sampleTripResponseSchema.parse(await res.json()) };
};
const trips = async (headers: Headers) => z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`, { headers })).json());

describe("opening the sample Trip", () => {
  it("gives a guest an editable copy: four Days, a Backlog, an Archive, Todos and Legs", async () => {
    const headers = guest();
    const opened = await openSample(headers);
    expect(opened.status).toBe(201);
    expect(opened.body.created).toBe(true);

    const [trip, ...others] = await trips(headers);
    expect(others).toEqual([]);
    expect(trip).toMatchObject({ id: opened.body.tripId, title: "Kyoto & Osaka", role: "owner" });
    expect(trip!.days.map((d) => d.position)).toEqual([1, 2, 3, 4]);
    expect(trip!.days.every((d) => d.events.length > 0)).toBe(true);
    expect(trip!.backlog).toHaveLength(5);
    expect(trip!.archive).toHaveLength(2);
    expect(trip!.todos).toHaveLength(5);
    expect(trip!.todos.filter((t) => t.eventId)).toHaveLength(2);
    expect(trip!.legs.length).toBeGreaterThan(0);
    // The Days have dates, and a Lodging spans two nights.
    expect(new Date(`${trip!.startDate}T00:00:00Z`).getUTCDay()).toBe(2);
    expect(trip!.days[0]!.events.find((e) => e.kind === "lodging")).toMatchObject({ nights: 2 });
    // Nanzen-ji closes at 17:00 and is planned from 17:45, so the opening-hours warning shows (design 01).
    const nanzenji = trip!.days[1]!.events.find((e) => e.title === "Nanzen-ji");
    expect(nanzenji?.openingHoursOn).toBeTruthy();
    // Places are the provider's ids, known to the place cache.
    const placeIds = trip!.days.flatMap((d) => d.events.flatMap((e) => (e.placeId ? [e.placeId] : [])));
    expect(placeIds.length).toBeGreaterThan(8);
    const known = await fetch(`${app.baseUrl}/api/places?ids=${placeIds.slice(0, 5).join(",")}`, { headers });
    expect(((await known.json()) as { places: unknown[] }).places).toHaveLength(5);
  });

  it("opens the copy the user has instead of making another", async () => {
    const headers = guest();
    const first = await openSample(headers);
    const again = await openSample(headers);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ tripId: first.body.tripId, created: false });
    expect(await trips(headers)).toHaveLength(1);
  });

  it("makes one copy when two requests come at once", async () => {
    const headers = guest();
    const [a, b] = await Promise.all([openSample(headers), openSample(headers)]);
    expect(a.body.tripId).toBe(b.body.tripId);
    expect(await trips(headers)).toHaveLength(1);
  });

  it("gives each user their own copy, and an account can open it too", async () => {
    const a = await openSample(guest());
    const b = await openSample(account);
    expect(b.body.created).toBe(true);
    expect(b.body.tripId).not.toBe(a.body.tripId);
    expect(await trips(account)).toHaveLength(1);
  });

  it("does not change what the user edited when it is opened again", async () => {
    const headers = guest();
    const { body } = await openSample(headers);
    await fetch(`${app.baseUrl}/api/trips/${body.tripId}`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ startDate: "2027-01-05" }),
    });
    await openSample(headers);
    expect((await trips(headers))[0]!.startDate).toBe("2027-01-05");
  });
});

describe("a guest's sample copy after login", () => {
  const merge = (headers: Headers) => fetch(`${app.baseUrl}/api/me/merge-guest`, { method: "POST", headers });

  it("moves to an account that has none", async () => {
    const headers = guest();
    const { body } = await openSample(headers);
    await merge({ ...account, ...headers });
    expect((await trips(account)).map((t) => t.id)).toEqual([body.tripId]);
    expect(await openSample(account)).toMatchObject({ body: { tripId: body.tripId, created: false } });
  });

  it("stays as an ordinary Trip next to the account's own copy, which Open a sample Trip still opens", async () => {
    const own = await openSample(account);
    const headers = guest();
    const copy = await openSample(headers);
    expect((await merge({ ...account, ...headers })).status).toBe(200);

    expect((await trips(account)).map((t) => t.id).sort()).toEqual([own.body.tripId, copy.body.tripId].sort());
    expect(await openSample(account)).toMatchObject({ body: { tripId: own.body.tripId, created: false } });
  });
});

describe("when the place provider is down", () => {
  it("still makes the copy, with Events that have no place", async () => {
    const down = { ...fakePlaceProvider(), search: async () => Promise.reject(new PlaceProviderError("down")) };
    const broken = await startTestApp(down);
    try {
      const headers = { "x-guest-id": crypto.randomUUID() };
      const res = await fetch(`${broken.baseUrl}/api/sample-trip`, { method: "POST", headers });
      expect(res.status).toBe(201);
      const [trip] = z.array(tripSchema).parse(await (await fetch(`${broken.baseUrl}/api/trips`, { headers })).json());
      expect(trip!.days).toHaveLength(4);
      expect(trip!.days.flatMap((d) => d.events).every((e) => e.placeId === null)).toBe(true);
      expect(trip!.legs).toEqual([]);
    } finally {
      await broken.stop();
    }
  });
});

describe("the pinned place ids", () => {
  const stationId = SAMPLE_PLACES.kyotoStation.id;
  const placeIdsOf = async (baseUrl: string, headers: Headers) => {
    const [trip] = z.array(tripSchema).parse(await (await fetch(`${baseUrl}/api/trips`, { headers })).json());
    return trip!.days.flatMap((d) => d.events.flatMap((e) => (e.placeId ? [e.placeId] : [])));
  };

  it("are used without a search when the provider knows them", async () => {
    const station = { id: stationId, name: "Kyoto Station", address: "Kyoto", area: "Shimogyo Ward, Kyoto", lat: 34.98, lng: 135.76 };
    const searched: string[] = [];
    const provider = {
      ...fakePlaceProvider(),
      get: async (id: string) => (id === stationId ? station : undefined),
      search: async (query: string) => (searched.push(query), []),
    };
    const pinned = await startTestApp(provider);
    try {
      const headers = { "x-guest-id": crypto.randomUUID() };
      await fetch(`${pinned.baseUrl}/api/sample-trip`, { method: "POST", headers });
      expect(searched).not.toContain("Kyoto Station");
      expect(await placeIdsOf(pinned.baseUrl, headers)).toContain(stationId);
    } finally {
      await pinned.stop();
    }
  });

  it("fall back to the name with a provider that does not know them", async () => {
    const headers = guest();
    await openSample(headers);
    const ids = await placeIdsOf(app.baseUrl, headers);
    expect(ids).toContain("fake:kyoto-station");
    expect(ids).not.toContain(stationId);
  });
});

describe("sampleStartDate", () => {
  it("is today on a Tuesday and the next Tuesday on any other day", () => {
    expect(sampleStartDate(new Date("2026-10-20T23:30:00Z"))).toBe("2026-10-20");
    expect(sampleStartDate(new Date("2026-10-21T00:00:00Z"))).toBe("2026-10-27");
    expect(sampleStartDate(new Date("2026-10-26T12:00:00Z"))).toBe("2026-10-27");
  });
});
