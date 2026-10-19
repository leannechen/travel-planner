import { placeSchema, type Place } from "@travel-planner/shared";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import { places } from "./db/schema";

// Where place data comes from. The app only ever stores a place's id on an Event; the rest is
// fetched through the provider and cached for a limited time (ADR 0007).
export type PlaceProvider = {
  search(query: string): Promise<Place[]>;
  get(id: string): Promise<Place | undefined>;
};

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

export function fakePlaceProvider(): PlaceProvider {
  return {
    async search(query) {
      const q = query.trim().toLowerCase();
      return FAKE_PLACES.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q)).slice(0, MAX_SEARCH_RESULTS);
    },
    async get(id) {
      return FAKE_PLACES.find((p) => p.id === id);
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

const FIELDS = "id,displayName,formattedAddress,location";

// Google Places API (New). Place search is a text query; details are read by place id.
export function googlePlaceProvider(apiKey: string, fetchFn: typeof fetch = fetch): PlaceProvider {
  const base = "https://places.googleapis.com/v1";
  return {
    async search(query) {
      const res = await fetchFn(`${base}/places:searchText`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS.split(",").map((f) => `places.${f}`).join(",") },
        body: JSON.stringify({ textQuery: query, maxResultCount: MAX_SEARCH_RESULTS }),
      });
      if (!res.ok) throw new Error(`Place search failed (${res.status})`);
      const body = (await res.json()) as { places?: unknown[] };
      return (body.places ?? []).map(fromGoogle).filter((p): p is Place => p !== undefined);
    },
    async get(id) {
      const res = await fetchFn(`${base}/places/${encodeURIComponent(id)}`, {
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS },
      });
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`Place lookup failed (${res.status})`);
      return fromGoogle(await res.json());
    },
  };
}

// Google when a key is set, the fake places otherwise.
export function placeProviderFromEnv(env: NodeJS.ProcessEnv = process.env): PlaceProvider {
  return env.GOOGLE_MAPS_API_KEY ? googlePlaceProvider(env.GOOGLE_MAPS_API_KEY) : fakePlaceProvider();
}

async function remember(db: Db, found: Place[], now: Date) {
  if (found.length === 0) return;
  await db
    .insert(places)
    .values(found.map((p) => ({ ...p, fetchedAt: now })))
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
  const rows = await db.select().from(places).where(inArray(places.id, unique));
  const oldest = now.getTime() - PLACE_CACHE_DAYS * 24 * 60 * 60 * 1000;
  const known = new Map<string, Place>();
  const refetch: string[] = [];
  for (const id of unique) {
    const row = rows.find((r) => r.id === id);
    if (row && row.fetchedAt.getTime() > oldest) known.set(id, placeSchema.parse({ id, name: row.name, address: row.address, lat: row.lat, lng: row.lng }));
    else refetch.push(id);
  }
  const fetched = await Promise.all(refetch.map((id) => provider.get(id)));
  const fresh = fetched.filter((p): p is Place => p !== undefined);
  await remember(db, fresh, now);
  for (const p of fresh) known.set(p.id, p);
  const gone = refetch.filter((id) => !known.has(id));
  if (gone.length > 0) await db.delete(places).where(inArray(places.id, gone));
  return ids.flatMap((id) => (known.has(id) ? [known.get(id)!] : [])).filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i);
}
