import { daily, openingHoursSchema, placePhotoRefSchema, placeSchema, WEEK_MINUTES, type OpeningHours, type Place, type PlacePhoto, type PlacePhotoRef } from "@travel-planner/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import { placeQueries, places } from "./db/schema";
import { UsageLimitError } from "./usage";

// Where place data comes from. The app only ever stores a place's id on an Event; the rest is
// fetched through the provider and cached for a limited time (ADR 0007).
export type PlaceProvider = {
  // Which provider this is ("google", "fake"): ids from one are not used with another.
  name: string;
  search(query: string): Promise<Place[]>;
  // The id of the first place a query finds, or undefined when it finds none. Cheaper than a search:
  // only the id is asked for (ADR 0008).
  findId(query: string): Promise<string | undefined>;
  get(id: string): Promise<Place | undefined>;
  // The usual weekly opening hours, or undefined when the provider has none for the place (or does
  // not know it). Asked for only when the user turns opening hours on (PRD §3.5).
  getOpeningHours(id: string): Promise<OpeningHours | undefined>;
  // The reference to the place's first photo, or undefined when it has none (or is not known).
  getPhoto(id: string): Promise<PlacePhotoRef | undefined>;
  // A short-lived address to show that photo from, or undefined when the reference no longer works.
  // The picture is shown from there and never stored (PRD §3.2).
  getPhotoUri(ref: PlacePhotoRef): Promise<string | undefined>;
};

// The provider could not be reached, timed out, or gave an answer that makes no sense.
export class PlaceProviderError extends Error {}

// How long cached place data may be used before it is fetched again.
export const PLACE_CACHE_DAYS = 30;
const MAX_SEARCH_RESULTS = 8;

const JAPAN_UTC_OFFSET = 9 * 60;

// A few places in Kyoto, Osaka and Nara for development and tests, so no key is needed.
const FAKE_PLACES: Place[] = [
  ["fushimi-inari", "Fushimi Inari Taisha", "68 Fukakusa Yabunouchicho, Fushimi Ward, Kyoto", "Fushimi Ward, Kyoto", 34.9671, 135.7727],
  ["kinkaku-ji", "Kinkaku-ji", "1 Kinkakujicho, Kita Ward, Kyoto", "Kita Ward, Kyoto", 35.0394, 135.7292],
  ["arashiyama-bamboo", "Arashiyama Bamboo Grove", "Sagaotenryuji Susukinobabacho, Ukyo Ward, Kyoto", "Ukyo Ward, Kyoto", 35.017, 135.6713],
  ["nishiki-market", "Nishiki Market", "Nishidaimonjicho, Nakagyo Ward, Kyoto", "Nakagyo Ward, Kyoto", 35.005, 135.7649],
  ["kyoto-station", "Kyoto Station", "Higashishiokojicho, Shimogyo Ward, Kyoto", "Shimogyo Ward, Kyoto", 34.9858, 135.7588],
  ["granvia-kyoto", "Hotel Granvia Kyoto", "JR Kyoto Station Karasuma Central Exit, Kyoto", "Shimogyo Ward, Kyoto", 34.9855, 135.7587],
  ["osaka-castle", "Osaka Castle", "1-1 Osakajo, Chuo Ward, Osaka", "Chuo Ward, Osaka", 34.6873, 135.5262],
  ["dotonbori", "Dotonbori", "Dotonbori, Chuo Ward, Osaka", "Chuo Ward, Osaka", 34.6687, 135.5013],
  ["osaka-nanko-port", "Osaka Nanko Port", "Nanko Kita, Suminoe Ward, Osaka", "Suminoe Ward, Osaka", 34.6112, 135.4153],
  ["nara-park", "Nara Park", "Zoshicho, Nara", "Nara", 34.685, 135.8430],
  ["todai-ji", "Todai-ji", "406-1 Zoshicho, Nara", "Nara", 34.6890, 135.8398],
  ["beppu-port", "Beppu International Tourist Port", "Beppu, Oita", "Beppu", 33.2892, 131.5001],
  // The places of the sample Trip (sample-trip.ts).
  ["tokyo-station", "Tokyo Station", "1 Chome Marunouchi, Chiyoda City, Tokyo", "Chiyoda City, Tokyo", 35.6812, 139.7671],
  ["kiyomizu-dera", "Kiyomizu-dera", "294 Kiyomizu, Higashiyama Ward, Kyoto", "Higashiyama Ward, Kyoto", 34.9949, 135.785],
  ["pontocho", "Pontocho", "Pontocho, Nakagyo Ward, Kyoto", "Nakagyo Ward, Kyoto", 35.0052, 135.7708],
  ["tenryu-ji", "Tenryu-ji", "68 Susukinobabacho, Sagatenryuji, Ukyo Ward, Kyoto", "Ukyo Ward, Kyoto", 35.0157, 135.6738],
  ["philosophers-path", "Philosopher's Path", "Sakyo Ward, Kyoto", "Sakyo Ward, Kyoto", 35.0271, 135.7948],
  ["osaka-station", "Osaka Station", "3 Chome Umeda, Kita Ward, Osaka", "Kita Ward, Osaka", 34.7025, 135.4959],
  ["cross-hotel-osaka", "Cross Hotel Osaka", "2 Chome Shinsaibashisuji, Chuo Ward, Osaka", "Chuo Ward, Osaka", 34.6728, 135.5013],
  ["usj", "Universal Studios Japan", "2 Chome Sakurajima, Konohana Ward, Osaka", "Konohana Ward, Osaka", 34.6654, 135.4323],
  ["kansai-airport", "Kansai International Airport", "1 Senshukukokita, Izumisano, Osaka", "Izumisano, Osaka", 34.4347, 135.244],
  ["nanzen-ji", "Nanzen-ji", "86 Nanzenji Fukuchicho, Sakyo Ward, Kyoto", "Sakyo Ward, Kyoto", 35.0114, 135.7939],
].map(([id, name, address, area, lat, lng]) => ({ id: `fake:${id}`, name, address, area, lat, lng, utcOffsetMinutes: JAPAN_UTC_OFFSET }) as Place);

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

// Hours for some of the fake places, so every case can be tried: open all the time, a daily range, a
// weekly closure with a lunch break, hours past midnight, a place closed for good. The others have none.
const FAKE_HOURS: Record<string, OpeningHours> = {
  "fake:fushimi-inari": { status: "open", periods: [{ start: 0, end: WEEK_MINUTES }] },
  "fake:kinkaku-ji": daily(h(9), h(17)),
  "fake:nanzen-ji": daily(h(8, 40), h(17)),
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

// Places without a photo among the fake ones, so that case can be tried.
const FAKE_WITHOUT_PHOTO = new Set(["fake:granvia-kyoto", "fake:beppu-port"]);

// A plain picture drawn from the place's name, so a photo can be shown without a key.
function fakePhotoUri(name: string): string {
  const hue = [...name].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 360, 7);
  const label = name.replace(/[<>&"']/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 60% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 55% 38%)"/></linearGradient></defs>` +
    `<rect width="1200" height="800" fill="url(#g)"/>` +
    `<text x="600" y="420" font-family="sans-serif" font-size="64" fill="white" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function fakePlaceProvider(): PlaceProvider {
  const search = async (query: string) => {
    const q = query.trim().toLowerCase();
    return FAKE_PLACES.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q)).slice(0, MAX_SEARCH_RESULTS);
  };
  return {
    name: "fake",
    async getPhoto(id) {
      const place = FAKE_PLACES.find((p) => p.id === id);
      if (!place || FAKE_WITHOUT_PHOTO.has(id)) return undefined;
      return { name: `fake:${place.name}`, authors: [{ name: "A fake photographer", uri: null }] };
    },
    async getPhotoUri(ref) {
      return ref.name.startsWith("fake:") ? fakePhotoUri(ref.name.slice("fake:".length)) : undefined;
    },
    search,
    async findId(query) {
      return (await search(query))[0]?.id;
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
  addressComponents: z.array(z.object({ longText: z.string().optional(), types: z.array(z.string()).optional() })).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  utcOffsetMinutes: z.number().int().optional(),
});

type AddressComponent = { longText?: string; types?: string[] };

// The short area for an Event block from Google's address components: the district (a ward in
// Japan) and the city, "Fushimi Ward, Kyoto". The street and number are left out, as the block
// is narrow; the first component of each kind wins. Either part may be missing, and a district
// named like its city ("Singapore") is not repeated.
export function areaFromComponents(components: AddressComponent[] = []): string {
  const find = (...types: string[]) => {
    for (const type of types) {
      const found = components.find((c) => c.longText && c.types?.includes(type));
      if (found) return found.longText!;
    }
    return undefined;
  };
  const district = find("sublocality_level_1", "sublocality", "neighborhood");
  const city = find("locality", "postal_town", "administrative_area_level_2", "administrative_area_level_1");
  return [...new Set([district, city].filter((part): part is string => !!part))].join(", ");
}

function fromGoogle(raw: unknown): Place | undefined {
  const parsed = googlePlaceSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.location) return undefined;
  const { id, displayName, formattedAddress, addressComponents, location, utcOffsetMinutes } = parsed.data;
  return { id, name: displayName?.text ?? "", address: formattedAddress ?? "", area: areaFromComponents(addressComponents), lat: location.latitude, lng: location.longitude, utcOffsetMinutes };
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
  // An answer that makes no sense is a failure, not "no hours", so it is not cached as such.
  if (!parsed.success) throw new PlaceProviderError("Place opening hours failed (unexpected answer)");
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
  if (!openingHoursSchema.safeParse(result).success) throw new PlaceProviderError("Place opening hours failed (unexpected answer)");
  return result;
}

const googlePhotosSchema = z.object({
  photos: z
    .array(z.object({ name: z.string(), authorAttributions: z.array(z.object({ displayName: z.string().optional(), uri: z.string().optional() })).optional() }))
    .optional(),
});

// Google gives addresses without a scheme ("//maps.google.com/..."); only https ones are passed on.
function httpsAddress(raw: string | undefined): string | null {
  const url = raw?.startsWith("//") ? `https:${raw}` : raw;
  return url?.startsWith("https://") ? url : null;
}

// A photo's resource name as Google writes it; it goes into a request address, so nothing else is let in.
const PHOTO_NAME = /^places\/[\w-]+\/photos\/[\w-]+$/;
// The widest picture asked for: enough for the large view, and the same one is used for the thumbnail.
const PHOTO_WIDTH_PX = 1200;

const REQUEST_TIMEOUT_MS = 5000;

const FIELDS = "id,displayName,formattedAddress,addressComponents,location,utcOffsetMinutes";
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
    name: "google",
    async search(query) {
      const { body } = await call("search", `${base}/places:searchText`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS.split(",").map((f) => `places.${f}`).join(",") },
        body: JSON.stringify({ textQuery: query, maxResultCount: MAX_SEARCH_RESULTS }),
      });
      return ((body as { places?: unknown[] }).places ?? []).map(fromGoogle).filter((p): p is Place => p !== undefined);
    },
    // Asks for the id only, which Text Search bills as "Essentials IDs Only" (no charge).
    async findId(query) {
      const { body } = await call("search", `${base}/places:searchText`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id" },
        body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
      });
      const parsed = z.object({ places: z.array(z.object({ id: z.string() })).optional() }).safeParse(body);
      if (!parsed.success) throw new PlaceProviderError("Place search failed (unexpected answer)");
      return parsed.data.places?.[0]?.id;
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
    async getPhoto(id) {
      const { body } = await call("photo", `${base}/places/${encodeURIComponent(id)}`, {
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "id,photos" },
      });
      if (body === undefined) return undefined;
      const parsed = googlePhotosSchema.safeParse(body);
      if (!parsed.success) throw new PlaceProviderError("Place photo failed (unexpected answer)");
      const first = parsed.data.photos?.[0];
      if (!first || !PHOTO_NAME.test(first.name)) return undefined;
      const authors = (first.authorAttributions ?? []).flatMap((a) => (a.displayName ? [{ name: a.displayName, uri: httpsAddress(a.uri) }] : []));
      return { name: first.name, authors: authors.slice(0, 5) };
    },
    async getPhotoUri(ref) {
      if (!PHOTO_NAME.test(ref.name)) return undefined;
      const { body } = await call("photo", `${base}/${ref.name}/media?maxWidthPx=${PHOTO_WIDTH_PX}&skipHttpRedirect=true`, {
        headers: { "X-Goog-Api-Key": apiKey },
      });
      if (body === undefined) return undefined;
      const parsed = z.object({ photoUri: z.string() }).safeParse(body);
      const uri = parsed.success ? httpsAddress(parsed.data.photoUri) : null;
      if (!uri) throw new PlaceProviderError("Place photo failed (unexpected answer)");
      return uri;
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
      set: { name: sql`excluded."name"`, address: sql`excluded."address"`, area: sql`excluded."area"`, lat: sql`excluded."lat"`, lng: sql`excluded."lng"`, utcOffsetMinutes: sql`excluded."utcOffsetMinutes"`, fetchedAt: now },
    });
}

// The place id each query finds (keys are the queries as given), or null when it finds none. What a
// query found is kept in `place_queries` and used again until it is old; a query the provider could
// not answer is left out (and not kept), so its Event simply has no place.
const LOOKUP_BATCH = 5;

// Asks about every id, a few at a time so a long Trip does not send dozens of requests at once, and
// settles like Promise.allSettled: one result per id, in the same order. Once a usage limit (plan
// step 33) refuses one, the ids not asked about yet fail the same way without being asked.
async function settleInBatches<T>(ids: string[], ask: (id: string) => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  const settled: PromiseSettledResult<T>[] = [];
  for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
    const limited = settled.find((r): r is PromiseRejectedResult => r.status === "rejected" && r.reason instanceof UsageLimitError);
    const batch = ids.slice(i, i + LOOKUP_BATCH);
    settled.push(...(limited ? batch.map(() => limited) : await Promise.allSettled(batch.map(ask))));
  }
  return settled;
}

export async function findPlaceIds(db: Db, provider: PlaceProvider, queries: string[], now = new Date()): Promise<Map<string, string | null>> {
  const keyOf = (query: string) => query.trim().toLowerCase();
  // Each key with the query as first written, which is what the provider is asked.
  const written = new Map<string, string>();
  for (const q of queries) if (!written.has(keyOf(q))) written.set(keyOf(q), q.trim());
  const keys = [...written.keys()];
  const found = new Map<string, string | null>();
  if (keys.length === 0) return found;
  const oldest = now.getTime() - PLACE_CACHE_DAYS * 24 * 60 * 60 * 1000;
  const rows = await db
    .select()
    .from(placeQueries)
    .where(and(eq(placeQueries.provider, provider.name), inArray(placeQueries.query, keys)));
  for (const row of rows) if (row.fetchedAt.getTime() > oldest) found.set(row.query, row.placeId);

  const missing = keys.filter((key) => !found.has(key));
  // A few at a time, so a long Trip does not send dozens of requests at once.
  for (let i = 0; i < missing.length; i += LOOKUP_BATCH) {
    const batch = missing.slice(i, i + LOOKUP_BATCH);
    const settled = await Promise.allSettled(batch.map((key) => provider.findId(written.get(key)!)));
    const answered = batch.flatMap((key, j) => {
      const r = settled[j]!;
      if (r.status === "rejected") {
        if (!(r.reason instanceof PlaceProviderError)) throw r.reason;
        return [];
      }
      return [{ provider: provider.name, query: key, placeId: r.value ?? null, fetchedAt: now }];
    });
    if (answered.length === 0) continue;
    await db
      .insert(placeQueries)
      .values(answered)
      .onConflictDoUpdate({ target: [placeQueries.provider, placeQueries.query], set: { placeId: sql`excluded."placeId"`, fetchedAt: now } });
    for (const a of answered) found.set(a.query, a.placeId);
  }
  return new Map(queries.flatMap((q) => (found.has(keyOf(q)) ? [[q, found.get(keyOf(q))!] as const] : [])));
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
  // Fresh rows cached before the area existed (null): fetched again for the area, but served
  // without one if that fails, as they were before.
  const withoutArea = new Map<string, Place>();
  for (const id of unique) {
    const row = rows.get(id);
    const fresh = row && row.fetchedAt.getTime() > oldest;
    if (row && fresh && row.area !== null) known.set(id, placeSchema.parse({ id, name: row.name, address: row.address, area: row.area, lat: row.lat, lng: row.lng, utcOffsetMinutes: row.utcOffsetMinutes ?? undefined }));
    else {
      if (row && fresh) withoutArea.set(id, placeSchema.parse({ id, name: row.name, address: row.address, area: "", lat: row.lat, lng: row.lng, utcOffsetMinutes: row.utcOffsetMinutes ?? undefined }));
      refetch.push(id);
    }
  }
  const settled = await settleInBatches(refetch, (id) => provider.get(id));
  const fresh = settled.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  // What did arrive is kept even when another lookup failed.
  await remember(db, fresh, now);
  for (const p of fresh) known.set(p.id, p);
  for (const [i, r] of settled.entries()) {
    const id = refetch[i]!;
    if (r.status === "rejected" && withoutArea.has(id)) known.set(id, withoutArea.get(id)!);
  }
  const failed = settled.find((r, i): r is PromiseRejectedResult => r.status === "rejected" && !withoutArea.has(refetch[i]!));
  if (failed) throw failed.reason;
  const gone = refetch.filter((id) => !known.has(id));
  if (gone.length > 0) await db.delete(places).where(inArray(places.id, gone));
  return unique.flatMap((id) => known.get(id) ?? []);
}

// The ids getPlaces would ask the provider about: those with no fresh cached place.
export async function uncachedPlaceIds(db: Db, ids: string[], now = new Date()): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const oldest = now.getTime() - PLACE_CACHE_DAYS * 24 * 60 * 60 * 1000;
  const cached = new Set(
    (await db.select({ id: places.id, area: places.area, fetchedAt: places.fetchedAt }).from(places).where(inArray(places.id, unique)))
      .filter((r) => r.fetchedAt.getTime() > oldest && r.area !== null)
      .map((r) => r.id),
  );
  return unique.filter((id) => !cached.has(id));
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
  const settled = await settleInBatches(refetch, (id) => provider.getOpeningHours(id));
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

// The place's page on Google Maps (the terms ask that a place shown with its photo can be reached
// there); a fake place has none.
const mapsUriOf = (id: string) =>
  id.startsWith("fake:") ? null : `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${encodeURIComponent(id)}`;

// The place's photo to show, read through the place cache like its hours: the provider's reference is
// kept for PLACE_CACHE_DAYS (a place without a photo is remembered as such), the picture's address is
// asked for each time and never kept. A reference that no longer works is looked up again once.
// `undefined` means there is nothing to show; a provider that cannot be reached is an error.
export async function getPlacePhoto(db: Db, provider: PlaceProvider, id: string, now = new Date()): Promise<PlacePhoto | undefined> {
  const [place] = await getPlaces(db, provider, [id], now);
  if (!place) return undefined;
  const [row] = await db.select({ photo: places.photo, photoFetchedAt: places.photoFetchedAt }).from(places).where(eq(places.id, id));
  const oldest = now.getTime() - PLACE_CACHE_DAYS * 24 * 60 * 60 * 1000;

  let ref: PlacePhotoRef | undefined;
  let cached = false;
  if (row?.photoFetchedAt && row.photoFetchedAt.getTime() > oldest) {
    if (!row.photo) return undefined;
    const parsed = placePhotoRefSchema.safeParse(row.photo);
    if (parsed.success) {
      ref = parsed.data;
      cached = true;
    }
  }
  const lookUp = async () => {
    const found = await provider.getPhoto(id);
    await db.update(places).set({ photo: found ?? null, photoFetchedAt: now }).where(eq(places.id, id));
    return found;
  };
  ref ??= await lookUp();
  if (!ref) return undefined;
  let photoUri = await provider.getPhotoUri(ref);
  if (!photoUri && cached) {
    ref = await lookUp();
    photoUri = ref && (await provider.getPhotoUri(ref));
  }
  return ref && photoUri ? { photoUri, authors: ref.authors, mapsUri: mapsUriOf(id) } : undefined;
}
