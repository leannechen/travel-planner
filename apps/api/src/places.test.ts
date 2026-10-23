import type { Place } from "@travel-planner/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApp } from "../test/test-app";
import { placeQueries, places } from "./db/schema";
import { UsageLimitError } from "./usage";
import { areaFromComponents, fakePlaceProvider, fetchOpeningHours, findPlaceIds, getOpeningHours, getPlaces, googlePlaceProvider, PLACE_CACHE_DAYS, PlaceProviderError, searchPlaces, uncachedPlaceIds, type PlaceProvider } from "./places";

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
  const calls = { search: 0, findId: 0, get: 0, hours: 0, photo: 0, photoUri: 0 };
  const provider: PlaceProvider = {
    name: inner.name,
    search: (q) => (calls.search++, inner.search(q)),
    findId: (q) => (calls.findId++, inner.findId(q)),
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

  it("keeps the area with the place, and fetches a row cached before the area existed again", async () => {
    const { provider, calls } = counting();
    const now = new Date("2026-10-19T00:00:00Z");
    const [first] = await getPlaces(app.db, provider, ["fake:fushimi-inari"], now);
    expect(first!.area).toBe("Fushimi Ward, Kyoto");
    expect((await getPlaces(app.db, provider, ["fake:fushimi-inari"], now))[0]!.area).toBe("Fushimi Ward, Kyoto");
    expect(calls.get).toBe(1);
    await app.db.update(places).set({ area: null }).where(eq(places.id, "fake:fushimi-inari"));
    expect((await getPlaces(app.db, provider, ["fake:fushimi-inari"], now))[0]!.area).toBe("Fushimi Ward, Kyoto");
    expect(calls.get).toBe(2);
  });

  it("serves a fresh row without an area when fetching its area fails", async () => {
    const now = new Date("2026-10-19T00:00:00Z");
    await getPlaces(app.db, fakePlaceProvider(), ["fake:nara-park"], now);
    await app.db.update(places).set({ area: null }).where(eq(places.id, "fake:nara-park"));
    const inner = fakePlaceProvider();
    const down: PlaceProvider = { ...inner, get: () => Promise.reject(new PlaceProviderError("down")) };
    expect((await getPlaces(app.db, down, ["fake:nara-park"], now))[0]).toMatchObject({ id: "fake:nara-park", area: "" });
    await expect(getPlaces(app.db, down, ["fake:nara-park"], new Date(now.getTime() + (PLACE_CACHE_DAYS + 1) * DAY))).rejects.toThrow("down");
  });

  it("drops an id the provider no longer knows, and its cached row", async () => {
    const stale = new Date("2026-01-01T00:00:00Z");
    await app.db.insert(places).values({ id: "fake:gone", name: "Gone", address: "-", area: "", lat: 0, lng: 0, fetchedAt: stale });
    expect(await getPlaces(app.db, fakePlaceProvider(), ["fake:gone", "fake:nara-park"])).toHaveLength(1);
    expect(await app.db.select().from(places).where(eq(places.id, "fake:gone"))).toEqual([]);
  });

  it("keeps what arrived when another lookup fails, and then reports the failure", async () => {
    const inner = fakePlaceProvider();
    const provider: PlaceProvider = {
      ...inner,
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
    const provider: PlaceProvider = { name: "test", search: async () => [nara, nara], findId: async () => nara.id, get: async () => nara, getOpeningHours: async () => undefined, getPhoto: async () => undefined, getPhotoUri: async () => undefined };
    expect(await searchPlaces(app.db, provider, "nara")).toHaveLength(2);
    expect(await app.db.select().from(places)).toHaveLength(1);
  });

  it("keeps the order of the ids and skips repeats", async () => {
    const found = await getPlaces(app.db, fakePlaceProvider(), ["fake:todai-ji", "fake:nara-park", "fake:todai-ji"]);
    expect(found.map((p) => p.id)).toEqual(["fake:todai-ji", "fake:nara-park"]);
  });

  it("asks the provider about a few places at a time, and still about every one", async () => {
    const inner = fakePlaceProvider();
    let running = 0;
    let most = 0;
    const asked: string[] = [];
    const provider: PlaceProvider = {
      ...inner,
      get: async (id) => {
        asked.push(id);
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return inner.get(id);
      },
    };
    const ids = ["fake:nara-park", ...Array.from({ length: 11 }, (_, i) => `fake:none-${i}`), "fake:todai-ji"];
    const found = await getPlaces(app.db, provider, ids);
    expect(found.map((p) => p.id)).toEqual(["fake:nara-park", "fake:todai-ji"]);
    expect(asked).toHaveLength(ids.length);
    expect(most).toBe(5);
  });

  it("stops asking once a usage limit refuses a lookup", async () => {
    const inner = fakePlaceProvider();
    let asked = 0;
    const provider: PlaceProvider = {
      ...inner,
      get: async (id) => {
        if (++asked > 3) throw new UsageLimitError("lookup", "day");
        return inner.get(id);
      },
    };
    const ids = Array.from({ length: 20 }, (_, i) => `fake:none-${i}`);
    await expect(getPlaces(app.db, provider, ids)).rejects.toThrow(UsageLimitError);
    expect(asked).toBe(5);
  });

  it("tells which ids are not cached yet", async () => {
    await getPlaces(app.db, fakePlaceProvider(), ["fake:nara-park"]);
    expect(await uncachedPlaceIds(app.db, ["fake:nara-park", "fake:todai-ji", "fake:todai-ji"])).toEqual(["fake:todai-ji"]);
    expect(await uncachedPlaceIds(app.db, ["fake:nara-park"], new Date(Date.now() + (PLACE_CACHE_DAYS + 1) * DAY))).toEqual(["fake:nara-park"]);
  });
});

describe("finding place ids for queries", () => {
  it("keeps what a query found, also nothing, and asks again once it is old", async () => {
    const { provider, calls } = counting();
    const now = new Date();
    const found = await findPlaceIds(app.db, provider, ["Nara Park", "  nara park ", "Nowhere at all"], now);
    expect([...found]).toEqual([
      ["Nara Park", "fake:nara-park"],
      ["  nara park ", "fake:nara-park"],
      ["Nowhere at all", null],
    ]);
    expect(calls.findId).toBe(2);

    await findPlaceIds(app.db, provider, ["NARA PARK", "Nowhere at all"], now);
    expect(calls.findId).toBe(2);
    await findPlaceIds(app.db, provider, ["Nara Park"], new Date(now.getTime() + (PLACE_CACHE_DAYS + 1) * DAY));
    expect(calls.findId).toBe(3);
  });

  it("leaves out a query the provider could not answer, and does not keep it", async () => {
    const down: PlaceProvider = { ...fakePlaceProvider(), findId: (q) => (q === "Todai-ji" ? Promise.reject(new PlaceProviderError("down")) : fakePlaceProvider().findId(q)) };
    const found = await findPlaceIds(app.db, down, ["Todai-ji", "Nara Park"]);
    expect([...found]).toEqual([["Nara Park", "fake:nara-park"]]);
    expect(await app.db.select().from(placeQueries).where(eq(placeQueries.query, "todai-ji"))).toEqual([]);
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

describe("Google place id search", () => {
  const reply = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  it("asks for the first place's id only, which Google does not charge for", async () => {
    const fetchFn = vi.fn(() => reply({ places: [{ id: "ChIJ1" }] }));
    expect(await googlePlaceProvider("KEY", fetchFn as unknown as typeof fetch).findId("Uffizi Gallery, Florence")).toBe("ChIJ1");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(init.headers).toMatchObject({ "X-Goog-FieldMask": "places.id" });
    expect(JSON.parse(init.body as string)).toEqual({ textQuery: "Uffizi Gallery, Florence", maxResultCount: 1 });
  });

  it("finds nothing in an empty answer, and fails on one that makes no sense", async () => {
    expect(await googlePlaceProvider("KEY", (() => reply({})) as unknown as typeof fetch).findId("x")).toBeUndefined();
    await expect(googlePlaceProvider("KEY", (() => reply({ places: "?" })) as unknown as typeof fetch).findId("x")).rejects.toThrow(PlaceProviderError);
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

describe("areaFromComponents", () => {
  const c = (longText: string, ...types: string[]) => ({ longText, types });
  it("joins the district and the city, leaving out the street", () => {
    const fushimi = [c("68", "premise"), c("Fukakusa Yabunouchichō", "sublocality_level_2"), c("Fushimi Ward", "sublocality_level_1", "sublocality"), c("Kyoto", "locality"), c("Kyoto", "administrative_area_level_1")];
    expect(areaFromComponents(fushimi)).toBe("Fushimi Ward, Kyoto");
  });
  it("uses what exists and does not repeat a name", () => {
    expect(areaFromComponents([c("Singapore", "locality", "country")])).toBe("Singapore");
    expect(areaFromComponents([c("Soho", "neighborhood"), c("London", "postal_town")])).toBe("Soho, London");
    expect(areaFromComponents([c("Japan", "country")])).toBe("");
    expect(areaFromComponents()).toBe("");
  });
});

describe("Google place provider", () => {
  const googlePlace = { id: "ChIJ123", displayName: { text: "Kinkaku-ji" }, formattedAddress: "Kyoto", addressComponents: [{ longText: "Kita Ward", types: ["sublocality_level_1", "sublocality"] }, { longText: "Kyoto", types: ["locality"] }], location: { latitude: 35.03, longitude: 135.72 } };
  const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

  it("searches with the key, a field mask and the text query", async () => {
    const fetchFn = vi.fn(() => reply({ places: [googlePlace, { id: "no-location" }] }));
    const found = await googlePlaceProvider("KEY", fetchFn as unknown as typeof fetch).search("kinkaku");
    expect(found).toEqual<Place[]>([{ id: "ChIJ123", name: "Kinkaku-ji", address: "Kyoto", area: "Kita Ward, Kyoto", lat: 35.03, lng: 135.72 }]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(init.headers).toMatchObject({ "X-Goog-Api-Key": "KEY", "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.utcOffsetMinutes" });
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
    expect(init.headers).toMatchObject({ "X-Goog-FieldMask": "id,displayName,formattedAddress,addressComponents,location,utcOffsetMinutes" });
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
