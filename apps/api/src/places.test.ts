import type { Place } from "@travel-planner/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApp } from "../test/test-app";
import { places } from "./db/schema";
import { fakePlaceProvider, fetchOpeningHours, getOpeningHours, getPlaces, googlePlaceProvider, PLACE_CACHE_DAYS, PlaceProviderError, searchPlaces, type PlaceProvider } from "./places";

let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(() => app.reset());
afterAll(() => app.stop());

const DAY = 24 * 60 * 60 * 1000;

// A provider that counts its lookups, over the fake places.
function counting() {
  const inner = fakePlaceProvider();
  const calls = { search: 0, get: 0, hours: 0, photo: 0, photoUri: 0 };
  const provider: PlaceProvider = {
    search: (q) => (calls.search++, inner.search(q)),
    get: (id) => (calls.get++, inner.get(id)),
    getOpeningHours: (id) => (calls.hours++, inner.getOpeningHours(id)),
    getPhoto: (id) => (calls.photo++, inner.getPhoto(id)),
    getPhotoUri: (ref) => (calls.photoUri++, inner.getPhotoUri(ref)),
  };
  return { provider, calls };
}

describe("fake place provider", () => {
  it("finds places by name or address, ignoring case", async () => {
    const found = await fakePlaceProvider().search("kyoto STATION");
    expect(found.map((p) => p.name)).toContain("Kyoto Station");
    expect(await fakePlaceProvider().search("no such place anywhere")).toEqual([]);
  });
});

describe("getPlaces", () => {
  it("serves a searched place from the cache, without asking the provider again", async () => {
    const { provider, calls } = counting();
    const [first] = await searchPlaces(app.db, provider, "Fushimi");
    expect(await getPlaces(app.db, provider, [first!.id])).toEqual([first]);
    expect(calls.get).toBe(0);
  });

  it("fetches an unknown id from the provider and remembers it", async () => {
    const { provider, calls } = counting();
    const [found] = await getPlaces(app.db, provider, ["fake:nara-park"]);
    expect(found?.name).toBe("Nara Park");
    await getPlaces(app.db, provider, ["fake:nara-park"]);
    expect(calls.get).toBe(1);
  });

  it("fetches data older than the cache limit again", async () => {
    const { provider, calls } = counting();
    const now = new Date("2026-10-19T00:00:00Z");
    await getPlaces(app.db, provider, ["fake:nara-park"], now);
    await getPlaces(app.db, provider, ["fake:nara-park"], new Date(now.getTime() + (PLACE_CACHE_DAYS - 1) * DAY));
    expect(calls.get).toBe(1);
    await getPlaces(app.db, provider, ["fake:nara-park"], new Date(now.getTime() + (PLACE_CACHE_DAYS + 1) * DAY));
    expect(calls.get).toBe(2);
  });

  it("drops an id the provider no longer knows, and its cached row", async () => {
    const stale = new Date("2026-01-01T00:00:00Z");
    await app.db.insert(places).values({ id: "fake:gone", name: "Gone", address: "-", lat: 0, lng: 0, fetchedAt: stale });
    expect(await getPlaces(app.db, fakePlaceProvider(), ["fake:gone", "fake:nara-park"])).toHaveLength(1);
    expect(await app.db.select().from(places).where(eq(places.id, "fake:gone"))).toEqual([]);
  });

  it("keeps what arrived when another lookup fails, and then reports the failure", async () => {
    const inner = fakePlaceProvider();
    const provider: PlaceProvider = {
      search: inner.search,
      getOpeningHours: inner.getOpeningHours,
      getPhoto: inner.getPhoto,
      getPhotoUri: inner.getPhotoUri,
      get: (id) => (id === "fake:broken" ? Promise.reject(new PlaceProviderError("down")) : inner.get(id)),
    };
    await expect(getPlaces(app.db, provider, ["fake:nara-park", "fake:broken"])).rejects.toThrow("down");
    const rows = await app.db.select().from(places).where(eq(places.id, "fake:nara-park"));
    expect(rows).toHaveLength(1);
  });

  it("caches a search whose results repeat an id", async () => {
    const nara = (await fakePlaceProvider().get("fake:nara-park"))!;
    const provider: PlaceProvider = { search: async () => [nara, nara], get: async () => nara, getOpeningHours: async () => undefined, getPhoto: async () => undefined, getPhotoUri: async () => undefined };
    expect(await searchPlaces(app.db, provider, "nara")).toHaveLength(2);
    expect(await app.db.select().from(places)).toHaveLength(1);
  });

  it("keeps the order of the ids and skips repeats", async () => {
    const found = await getPlaces(app.db, fakePlaceProvider(), ["fake:todai-ji", "fake:nara-park", "fake:todai-ji"]);
    expect(found.map((p) => p.id)).toEqual(["fake:todai-ji", "fake:nara-park"]);
  });
});

describe("opening hours cache", () => {
  const now = new Date("2026-10-19T00:00:00Z");

  it("fetches hours once, then serves them from the cache until they are old", async () => {
    const { provider, calls } = counting();
    await getPlaces(app.db, provider, ["fake:kinkaku-ji"], now);
    expect((await getOpeningHours(app.db, provider, ["fake:kinkaku-ji"], now)).get("fake:kinkaku-ji")?.periods).toHaveLength(7);
    await getOpeningHours(app.db, provider, ["fake:kinkaku-ji"], new Date(now.getTime() + (PLACE_CACHE_DAYS - 1) * DAY));
    expect(calls.hours).toBe(1);
    await getOpeningHours(app.db, provider, ["fake:kinkaku-ji"], new Date(now.getTime() + (PLACE_CACHE_DAYS + 1) * DAY));
    expect(calls.hours).toBe(2);
  });

  it("leaves out a place with no hours and does not ask for it again while the answer is fresh", async () => {
    const { provider, calls } = counting();
    await getPlaces(app.db, provider, ["fake:nara-park"], now);
    expect((await getOpeningHours(app.db, provider, ["fake:nara-park"], now)).size).toBe(0);
    await getOpeningHours(app.db, provider, ["fake:nara-park"], now);
    expect(calls.hours).toBe(1);
  });

  it("is not lost when the place data is refreshed", async () => {
    const { provider } = counting();
    await getPlaces(app.db, provider, ["fake:kinkaku-ji"], now);
    await getOpeningHours(app.db, provider, ["fake:kinkaku-ji"], now);
    await searchPlaces(app.db, provider, "Kinkaku", now);
    const [row] = await app.db.select().from(places).where(eq(places.id, "fake:kinkaku-ji"));
    expect(row?.openingHours).not.toBeNull();
  });

  it("leaves out a place whose hours could not be fetched, and keeps the others", async () => {
    const inner = fakePlaceProvider();
    const provider: PlaceProvider = {
      ...inner,
      getOpeningHours: (id) => (id === "fake:kinkaku-ji" ? Promise.reject(new PlaceProviderError("down")) : inner.getOpeningHours(id)),
    };
    await getPlaces(app.db, provider, ["fake:kinkaku-ji", "fake:dotonbori"], now);
    const found = await getOpeningHours(app.db, provider, ["fake:kinkaku-ji", "fake:dotonbori"], now);
    expect([...found.keys()]).toEqual(["fake:dotonbori"]);
  });

  it("reports a failed fetch for the one place the user asked about", async () => {
    const inner = fakePlaceProvider();
    const provider: PlaceProvider = { ...inner, getOpeningHours: () => Promise.reject(new PlaceProviderError("down")) };
    await expect(fetchOpeningHours(app.db, provider, "fake:kinkaku-ji", now)).rejects.toThrow("down");
    expect(await fetchOpeningHours(app.db, inner, "fake:nara-park", now)).toBeUndefined();
  });
});

describe("Google opening hours", () => {
  const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const point = (day: number, hour: number, minute = 0) => ({ day, hour, minute });
  const provider = (body: unknown, status = 200) => googlePlaceProvider("KEY", (() => reply(body, status)) as unknown as typeof fetch);

  it("asks for the hours and the business status only", async () => {
    const fetchFn = vi.fn(() => reply({ regularOpeningHours: { periods: [] } }));
    await googlePlaceProvider("KEY", fetchFn as unknown as typeof fetch).getOpeningHours("ChIJ123");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places/ChIJ123");
    expect(init.headers).toMatchObject({ "X-Goog-FieldMask": "id,regularOpeningHours,businessStatus" });
  });

  it("turns periods into minutes from Sunday 00:00", async () => {
    const hours = await provider({
      businessStatus: "OPERATIONAL",
      regularOpeningHours: { periods: [{ open: point(1, 9), close: point(1, 17, 30) }] },
    }).getOpeningHours("x");
    expect(hours).toEqual({ status: "open", periods: [{ start: 1440 + 540, end: 1440 + 1050 }] });
  });

  it("puts a period that ends on the next week after the end of this one", async () => {
    const hours = await provider({ regularOpeningHours: { periods: [{ open: point(6, 20), close: point(0, 3) }] } }).getOpeningHours("x");
    expect(hours?.periods).toEqual([{ start: 6 * 1440 + 1200, end: 7 * 1440 + 180 }]);
  });

  it("reads a period without a close as open all the time", async () => {
    const hours = await provider({ regularOpeningHours: { periods: [{ open: point(0, 0) }] } }).getOpeningHours("x");
    expect(hours?.periods).toEqual([{ start: 0, end: 7 * 1440 }]);
  });

  it("answers undefined without hours, and tells about a place that is closed", async () => {
    expect(await provider({ id: "x" }).getOpeningHours("x")).toBeUndefined();
    expect(await provider({ businessStatus: "CLOSED_PERMANENTLY" }).getOpeningHours("x")).toEqual({ status: "closed-permanently", periods: [] });
    expect(await provider({ businessStatus: "CLOSED_TEMPORARILY", regularOpeningHours: { periods: [{ open: point(1, 9), close: point(1, 17) }] } }).getOpeningHours("x")).toMatchObject({ status: "closed-temporarily" });
  });

  it("fails, rather than answering no hours, when the answer makes no sense", async () => {
    await expect(provider({ regularOpeningHours: { periods: [{ open: { day: 9, hour: 1, minute: 0 } }] } }).getOpeningHours("x")).rejects.toBeInstanceOf(PlaceProviderError);
    await expect(provider({ regularOpeningHours: { periods: "soon" } }).getOpeningHours("x")).rejects.toBeInstanceOf(PlaceProviderError);
  });

  it("answers undefined for an id Google does not know and fails on other errors", async () => {
    expect(await provider({}, 404).getOpeningHours("x")).toBeUndefined();
    await expect(provider({}, 403).getOpeningHours("x")).rejects.toThrow("Place opening hours failed (403)");
  });
});

describe("Google place provider", () => {
  const googlePlace = { id: "ChIJ123", displayName: { text: "Kinkaku-ji" }, formattedAddress: "Kyoto", location: { latitude: 35.03, longitude: 135.72 } };
  const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

  it("searches with the key, a field mask and the text query", async () => {
    const fetchFn = vi.fn(() => reply({ places: [googlePlace, { id: "no-location" }] }));
    const found = await googlePlaceProvider("KEY", fetchFn as unknown as typeof fetch).search("kinkaku");
    expect(found).toEqual<Place[]>([{ id: "ChIJ123", name: "Kinkaku-ji", address: "Kyoto", lat: 35.03, lng: 135.72 }]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(init.headers).toMatchObject({ "X-Goog-Api-Key": "KEY", "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location" });
    expect(JSON.parse(init.body as string)).toMatchObject({ textQuery: "kinkaku" });
  });

  it("reads a place by id, and answers undefined for an id Google does not know", async () => {
    const provider = googlePlaceProvider("KEY", ((url: string) =>
      url.endsWith("/ChIJ123") ? reply(googlePlace) : reply({}, 404)) as unknown as typeof fetch);
    expect((await provider.get("ChIJ123"))?.name).toBe("Kinkaku-ji");
    expect(await provider.get("missing")).toBeUndefined();
  });

  it("reads a place with the field mask and the encoded id, and treats a rejected id as unknown", async () => {
    const fetchFn = vi.fn(() => reply({}, 400));
    const provider = googlePlaceProvider("KEY", fetchFn as unknown as typeof fetch);
    expect(await provider.get("fake:nara park")).toBeUndefined();
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places/fake%3Anara%20park");
    expect(init.headers).toMatchObject({ "X-Goog-FieldMask": "id,displayName,formattedAddress,location" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns a network failure or a bad body into a provider error", async () => {
    const down = googlePlaceProvider("KEY", (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch);
    await expect(down.search("x")).rejects.toBeInstanceOf(PlaceProviderError);
    await expect(down.get("x")).rejects.toBeInstanceOf(PlaceProviderError);
    const garbled = googlePlaceProvider("KEY", (() => Promise.resolve(new Response("<html>", { status: 200 }))) as unknown as typeof fetch);
    await expect(garbled.search("x")).rejects.toBeInstanceOf(PlaceProviderError);
  });

  it("fails on other errors", async () => {
    const provider = googlePlaceProvider("KEY", (() => reply({}, 403)) as unknown as typeof fetch);
    await expect(provider.search("x")).rejects.toThrow("Place search failed (403)");
    await expect(provider.get("x")).rejects.toThrow("Place lookup failed (403)");
  });
});
