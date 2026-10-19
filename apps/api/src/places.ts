import { daily, openingHoursSchema, placeSchema, WEEK_MINUTES, type OpeningHours, type Place } from "@travel-planner/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import { places } from "./db/schema";

// Where place data comes from. The app only ever stores a place's id on an Event; the rest is
// fetched through the provider and cached for a limited time (ADR 0007).
export type PlaceProvider = {
  search(query: string): Promise<Place[]>;
  get(id: string): Promise<Place | undefined>;
  // The usual weekly opening hours, or undefined when the provider has none for the place (or does
  // not know it). Asked for only when the user turns opening hours on (PRD §3.5).
  getOpeningHours(id: string): Promise<OpeningHours | undefined>;
};

// The provider could not be reached, timed out, or gave an answer that makes no sense.
export class PlaceProviderError extends Error {}

// How long cached place data may be used before it is fetched again.
export const PLACE_CACHE_DAYS = 30;
const MAX_SEARCH_RESULTS = 8;

// A few places in Kyoto, Osaka and Nara for development and tests, so no key is needed.
const FAKE_PLACES: Place[] = [
  ["fushimi-inari", "Fushimi Inari Taisha", "68 Fukakusa Yabunouchicho, Fushimi Ward, Kyoto", 34.9671, 135.7727],
  ["kinkaku-ji", "Kinkaku-ji", "1 Kinkakujicho, Kita Ward, Kyoto", 35.0394, 135.7292],
  ["arashiyama-bamboo", "Arashiyama Bamboo Grove", "Sagaotenryuji Susukinobabacho, Ukyo Ward, Kyoto", 35.017, 135.6713],
  ["nishiki-market", "Nishiki Market", "Nishidaimonjicho, Nakagyo Ward, Kyoto", 35.005, 135.7649],
  ["kyoto-station", "Kyoto Station", "Higashishiokojicho, Shimogyo Ward, Kyoto", 34.9858, 135.7588],
  ["granvia-kyoto", "Hotel Granvia Kyoto", "JR Kyoto Station Karasuma Central Exit, Kyoto", 34.9855, 135.7587],
  ["osaka-castle", "Osaka Castle", "1-1 Osakajo, Chuo Ward, Osaka", 34.6873, 135.5262],
  ["dotonbori", "Dotonbori", "Dotonbori, Chuo Ward, Osaka", 34.6687, 135.5013],
  ["osaka-nanko-port", "Osaka Nanko Port", "Nanko Kita, Suminoe Ward, Osaka", 34.6112, 135.4153],
  ["nara-park", "Nara Park", "Zoshicho, Nara", 34.685, 135.8430],
  ["todai-ji", "Todai-ji", "406-1 Zoshicho, Nara", 34.6890, 135.8398],
  ["beppu-port", "Beppu International Tourist Port", "Beppu, Oita", 33.2892, 131.5001],
].map(([id, name, address, lat, lng]) => ({ id: `fake:${id}`, name, address, lat, lng }) as Place);

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

// Hours for some of the fake places, so every case can be tried: open all the time, a daily range, a
// weekly closure with a lunch break, hours past midnight, a place closed for good. The others have none.
const FAKE_HOURS: Record<string, OpeningHours> = {
  "fake:fushimi-inari": { status: "open", periods: [{ start: 0, end: WEEK_MINUTES }] },
  "fake:kinkaku-ji": daily(h(9), h(17)),
  // Monday closed; Tuesday to Friday 11:00 to 15:00 and 17:00 to 22:00; Saturday and Sunday 11:00 to 22:00.
  "fake:nishiki-market": {
    status: "open",
    periods: [
      ...[2, 3, 4, 5].flatMap((d) => [
        { start: d * 1440 + h(11), end: d * 1440 + h(15) },
        { start: d * 1440 + h(17), end: d * 1440 + h(22) },
      ]),
      ...[6, 0].map((d) => ({ start: d * 1440 + h(11), end: d * 1440 + h(22) })),
    ],
  },
  "fake:dotonbori": daily(h(17), h(26)),
  "fake:todai-ji": { ...daily(h(8), h(17)), status: "closed-temporarily" },
};

export function fakePlaceProvider(): PlaceProvider {
  return {
    async search(query) {
      const q = query.trim().toLowerCase();
      return FAKE_PLACES.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q)).slice(0, MAX_SEARCH_RESULTS);
    },
    async get(id) {
      return FAKE_PLACES.find((p) => p.id === id);
    },
    async getOpeningHours(id) {
      return FAKE_HOURS[id];
    },
  };
}

const googlePlaceSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
});

function fromGoogle(raw: unknown): Place | undefined {
  const parsed = googlePlaceSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.location) return undefined;
  const { id, displayName, formattedAddress, location } = parsed.data;
  return { id, name: displayName?.text ?? "", address: formattedAddress ?? "", lat: location.latitude, lng: location.longitude };
}

const googleHoursSchema = z.object({
  businessStatus: z.string().optional(),
  regularOpeningHours: z
    .object({
      periods: z
        .array(
          z.object({
            open: z.object({ day: z.number().int().min(0).max(6), hour: z.number().int(), minute: z.number().int() }),
            close: z.object({ day: z.number().int().min(0).max(6), hour: z.number().int(), minute: z.number().int() }).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

// Google's periods to minutes from Sunday 00:00. A period without a close is a place open all the
// time; a close at or before the open is on the next week (Saturday night into Sunday).
function fromGoogleHours(raw: unknown): OpeningHours | undefined {
  const parsed = googleHoursSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const status: OpeningHours["status"] =
    parsed.data.businessStatus === "CLOSED_PERMANENTLY" ? "closed-permanently" : parsed.data.businessStatus === "CLOSED_TEMPORARILY" ? "closed-temporarily" : "open";
  const given = parsed.data.regularOpeningHours?.periods;
  // Without periods there are no hours, unless the place is closed, which is worth telling.
  if (!given) return status === "open" ? undefined : { status, periods: [] };
  const periods = given.map(({ open, close }) => {
    const start = open.day * 1440 + open.hour * 60 + open.minute;
    if (!close) return { start: 0, end: WEEK_MINUTES };
    const end = close.day * 1440 + close.hour * 60 + close.minute;
    return { start, end: end <= start ? end + WEEK_MINUTES : end };
  });
  const result = { status, periods: periods.slice(0, 50) };
  return openingHoursSchema.safeParse(result).success ? result : undefined;
}

const REQUEST_TIMEOUT_MS = 5000;

const FIELDS = "id,displayName,formattedAddress,location";
const HOURS_FIELDS = "id,regularOpeningHours,businessStatus";

// Google Places API (New). Place search is a text query; details are read by place id.
export function googlePlaceProvider(apiKey: string, fetchFn: typeof fetch = fetch): PlaceProvider {
  const base = "https://places.googleapis.com/v1";
  // Sends a request and reads the JSON answer; every failure becomes a PlaceProviderError.
  async function call(what: string, url: string, init: RequestInit): Promise<{ status: number; body?: unknown }> {
    try {
      const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      // An id Google does not accept is answered with 400 or 404: the place is unknown, not a failure.
      if (init.method !== "POST" && (res.status === 400 || res.status === 404)) return { status: res.status };
      if (!res.ok) throw new PlaceProviderError(`Place ${what} failed (${res.status})`);
      return { status: res.status, body: await res.json() };
    } catch (err) {
      if (err instanceof PlaceProviderError) throw err;
      throw new PlaceProviderError(`Place ${what} failed (${err instanceof Error ? err.message : "unknown error"})`);
    }
  }
  return {
    async search(query) {
      const { body } = await call("search", `${base}/places:searchText`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS.split(",").map((f) => `places.${f}`).join(",") },
        body: JSON.stringify({ textQuery: query, maxResultCount: MAX_SEARCH_RESULTS }),
      });
      return ((body as { places?: unknown[] }).places ?? []).map(fromGoogle).filter((p): p is Place => p !== undefined);
    },
    async get(id) {
      const { body } = await call("lookup", `${base}/places/${encodeURIComponent(id)}`, {
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS },
      });
      return body === undefined ? undefined : fromGoogle(body);
    },
    async getOpeningHours(id) {
      const { body } = await call("opening hours", `${base}/places/${encodeURIComponent(id)}`, {
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": HOURS_FIELDS },
      });
      return body === undefined ? undefined : fromGoogleHours(body);
    },
  };
}

// Google when a key is set, the fake places otherwise.
export function placeProviderFromEnv(env: NodeJS.ProcessEnv = process.env): PlaceProvider {
  return env.GOOGLE_MAPS_API_KEY ? googlePlaceProvider(env.GOOGLE_MAPS_API_KEY) : fakePlaceProvider();
}

async function remember(db: Db, found: Place[], now: Date) {
  // One row per id: a repeated id in one statement makes Postgres refuse the whole insert.
  const once = [...new Map(found.map((p) => [p.id, p])).values()];
  if (once.length === 0) return;
  await db
    .insert(places)
    .values(once.map((p) => ({ ...p, fetchedAt: now })))
    .onConflictDoUpdate({
      target: places.id,
      set: { name: sql`excluded."name"`, address: sql`excluded."address"`, lat: sql`excluded."lat"`, lng: sql`excluded."lng"`, fetchedAt: now },
    });
}

// Searches the provider; what it returns is cached, so choosing a result needs no second lookup.
export async function searchPlaces(db: Db, provider: PlaceProvider, query: string, now = new Date()): Promise<Place[]> {
  const found = await provider.search(query);
  await remember(db, found, now);
  return found;
}

// The places for these ids, in the same order. Cached data younger than PLACE_CACHE_DAYS is used;
// older or missing data is fetched again. An id the provider no longer knows is left out.
export async function getPlaces(db: Db, provider: PlaceProvider, ids: string[], now = new Date()): Promise<Place[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = new Map((await db.select().from(places).where(inArray(places.id, unique))).map((r) => [r.id, r]));
  const oldest = now.getTime() - PLACE_CACHE_DAYS * 24 * 60 * 60 * 1000;
  const known = new Map<string, Place>();
  const refetch: string[] = [];
  for (const id of unique) {
    const row = rows.get(id);
    if (row && row.fetchedAt.getTime() > oldest) known.set(id, placeSchema.parse({ id, name: row.name, address: row.address, lat: row.lat, lng: row.lng }));
    else refetch.push(id);
  }
  const settled = await Promise.allSettled(refetch.map((id) => provider.get(id)));
  const fresh = settled.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  // What did arrive is kept even when another lookup failed.
  await remember(db, fresh, now);
  for (const p of fresh) known.set(p.id, p);
  const failed = settled.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
  const gone = refetch.filter((id) => !known.has(id));
  if (gone.length > 0) await db.delete(places).where(inArray(places.id, gone));
  return unique.flatMap((id) => known.get(id) ?? []);
}

// The opening hours for these place ids, read through the place cache like the place itself:
// cached hours younger than PLACE_CACHE_DAYS are used, older or missing ones are fetched again (and a
// place the provider has no hours for is remembered as such). A place left out has no hours, is not
// cached, or could not be fetched: the caller shows nothing for it and asks again next time.
type HoursRow = { openingHours: unknown; hoursFetchedAt: Date | null };

// The cached hours of a row when they are younger than PLACE_CACHE_DAYS: "none" for a place the
// provider has no hours for, undefined when they must be fetched again.
function cachedHours(row: HoursRow, now: Date): { hours?: OpeningHours } | undefined {
  const oldest = now.getTime() - PLACE_CACHE_DAYS * 24 * 60 * 60 * 1000;
  if (!row.hoursFetchedAt || row.hoursFetchedAt.getTime() <= oldest) return undefined;
  const parsed = openingHoursSchema.safeParse(row.openingHours);
  return parsed.success ? { hours: parsed.data } : {};
}

export async function getOpeningHours(db: Db, provider: PlaceProvider, ids: string[], now = new Date()): Promise<Map<string, OpeningHours>> {
  const unique = [...new Set(ids)];
  const found = new Map<string, OpeningHours>();
  if (unique.length === 0) return found;
  const rows = new Map((await db.select().from(places).where(inArray(places.id, unique))).map((r) => [r.id, r]));
  const refetch: string[] = [];
  for (const id of unique) {
    const row = rows.get(id);
    // Hours are only kept for a place that is cached; a new place is looked up first.
    if (!row) continue;
    const cached = cachedHours(row, now);
    if (!cached) refetch.push(id);
    else if (cached.hours) found.set(id, cached.hours);
  }
  const settled = await Promise.allSettled(refetch.map((id) => provider.getOpeningHours(id)));
  for (const [i, result] of settled.entries()) {
    if (result.status === "rejected") continue;
    const id = refetch[i]!;
    await db.update(places).set({ openingHours: result.value ?? null, hoursFetchedAt: now }).where(eq(places.id, id));
    if (result.value) found.set(id, result.value);
  }
  return found;
}

// Like getOpeningHours for one place, but a failed request is an error instead of "no hours", so the
// user who pressed the button is told. `undefined` means the provider has no hours for the place.
export async function fetchOpeningHours(db: Db, provider: PlaceProvider, id: string, now = new Date()): Promise<OpeningHours | undefined> {
  const [place] = await getPlaces(db, provider, [id], now);
  if (!place) return undefined;
  const [row] = await db.select().from(places).where(eq(places.id, id));
  const oldest = now.getTime() - PLACE_CACHE_DAYS * 24 * 60 * 60 * 1000;
  if (row?.hoursFetchedAt && row.hoursFetchedAt.getTime() > oldest) return openingHoursSchema.safeParse(row.openingHours).data;
  const hours = await provider.getOpeningHours(id);
  await db.update(places).set({ openingHours: hours ?? null, hoursFetchedAt: now }).where(eq(places.id, id));
  return hours;
}
