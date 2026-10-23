import type { Event, SeedEventInput, TravelMode, TripSeedInput } from "@travel-planner/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { trips } from "./db/schema";
import { isProviderError, type LegDeps } from "./legs";
import { writeTripSeed } from "./trip-seed";

// The sample Trip (PRD §1): four days in Kyoto and Osaka, as in design 01. Opening it gives the user
// an editable copy of this fixture; nothing about it is stored until then.
export const SAMPLE_KEY = "kyoto-osaka";
const SAMPLE_TITLE = "Kyoto & Osaka";
// The copy starts on the first Tuesday from today, so its Days have dates and the opening-hours
// check can show.
const START_WEEKDAY = 2;

// The places, by a key of this file. `id` is the Google place id, checked by eye with
// `npm run sample-places -w @travel-planner/api`; an Event keeps the provider's id (ADR 0007). With
// another provider (the fake one) or an id Google no longer knows, the place is found by `name`.
export const SAMPLE_PLACES = {
  tokyoStation: { name: "Tokyo Station", id: "ChIJC3Cf2PuLGGAROO00ukl8JwA" },
  kyotoStation: { name: "Kyoto Station", id: "ChIJ7wKLka4IAWARCByidG5EGrY" },
  granvia: { name: "Hotel Granvia Kyoto", id: "ChIJaVi89K4IAWAR4vsxLc_WnbM" },
  fushimiInari: { name: "Fushimi Inari Taisha", id: "ChIJIW0uPRUPAWAR6eI6dRzKGns" },
  kiyomizu: { name: "Kiyomizu-dera", id: "ChIJB_vchdMIAWARujTEUIZlr2I" },
  pontocho: { name: "Pontocho", id: "ChIJP2DblBgJAWARAgLlF0vWT6o" },
  bambooGrove: { name: "Arashiyama Bamboo Grove", id: "ChIJrYtcv-urAWAR3XzWvXv8n_s" },
  tenryuji: { name: "Tenryu-ji", id: "ChIJk54PuAGqAWARwEgz_9o-nM0" },
  kinkakuji: { name: "Kinkaku-ji", id: "ChIJvUbrwCCoAWARX2QiHCsn5A4" },
  nanzenji: { name: "Nanzen-ji", id: "ChIJ_fuXcyEJAWARTQDnx6Q5szg" },
  osakaStation: { name: "Osaka Station", id: "ChIJC6fjlY3mAGARSshZ6CLIrhs" },
  osakaCastle: { name: "Osaka Castle", id: "ChIJ_TooXM3gAGARQR6hXH3QAQ8" },
  crossHotel: { name: "Cross Hotel Osaka", id: "ChIJA0zO7hPnAGARHooEfgZ_MsY" },
  usj: { name: "Universal Studios Japan", id: "ChIJXeLVg9DgAGARqlIyMCX-BTY" },
  philosophersPath: { name: "Philosopher's Path", id: "ChIJV_CUrggJAWAR9IBSpzHzepE" },
  naraPark: { name: "Nara Park", id: "ChIJYWCMvZY5AWARVnREV_OsbPk" },
  dotonbori: { name: "Dotonbori", id: "ChIJ_fmKgRPnAGARkKWLtCYTu7g" },
  kansaiAirport: { name: "Kansai International Airport", id: "ChIJ9_rNIxO5AGARiI-QjZ-ncfE" },
} as const satisfies Record<string, { name: string; id?: string }>;
type PlaceKey = keyof typeof SAMPLE_PLACES;

const at = (hour: number, minute = 0) => hour * 60 + minute;

type SampleEvent = {
  // What a Todo of the fixture refers to.
  key?: string;
  title: string;
  kind?: "attraction" | "meal" | "lodging" | "transport";
  place?: PlaceKey;
  destination?: PlaceKey;
  label?: NonNullable<Event["transportLabel"]>;
  nights?: number;
  start: number;
  minutes: number;
  hours?: true;
  // The mode of the Leg to the Event after this one, when both have a place. Default: transit.
  legMode?: TravelMode;
};

const DAYS: SampleEvent[][] = [
  [
    { title: "Hotel Granvia Kyoto", kind: "lodging", place: "granvia", nights: 2, start: at(15), minutes: 60 },
    { title: "Shinkansen to Kyoto", kind: "transport", label: "train", place: "tokyoStation", destination: "kyotoStation", start: at(8, 30), minutes: 105, legMode: "drive" },
    { key: "fushimi", title: "Fushimi Inari Taisha", place: "fushimiInari", start: at(11), minutes: 120 },
    { title: "Inari soba lunch", kind: "meal", start: at(13, 30), minutes: 60 },
    { key: "kiyomizu", title: "Kiyomizu-dera", place: "kiyomizu", start: at(15), minutes: 120, legMode: "walk" },
    { title: "Dinner in Pontocho", kind: "meal", place: "pontocho", start: at(18, 30), minutes: 90 },
  ],
  [
    { title: "Arashiyama Bamboo Grove", place: "bambooGrove", start: at(8, 30), minutes: 90, legMode: "walk" },
    { title: "Tenryu-ji", place: "tenryuji", start: at(10, 30), minutes: 60 },
    { title: "Tofu lunch", kind: "meal", start: at(12), minutes: 60 },
    { title: "Kinkaku-ji", place: "kinkakuji", start: at(14), minutes: 90, hours: true },
    { title: "Tea ceremony", start: at(14, 30), minutes: 90 },
    { title: "Konbini stop", kind: "meal", start: at(17, 15), minutes: 30 },
    { title: "Nanzen-ji", place: "nanzenji", start: at(17, 45), minutes: 90, hours: true },
  ],
  [
    { title: "Cross Hotel Osaka", kind: "lodging", place: "crossHotel", nights: 2, start: at(15), minutes: 60 },
    { title: "Limited express to Osaka", kind: "transport", label: "train", place: "kyotoStation", destination: "osakaStation", start: at(10), minutes: 60, legMode: "drive" },
    { title: "Osaka Castle", place: "osakaCastle", start: at(12), minutes: 120 },
  ],
  [{ title: "Universal Studios Japan", place: "usj", start: at(9), minutes: 480 }],
];

const BACKLOG: SampleEvent[] = [
  { title: "Philosopher's Path", place: "philosophersPath", start: at(9), minutes: 90 },
  { title: "Nara deer park", place: "naraPark", start: at(9), minutes: 180 },
  { title: "Okonomiyaki in Dotonbori", kind: "meal", place: "dotonbori", start: at(18), minutes: 60 },
  { title: "Ryokan night in Kurama", kind: "lodging", nights: 1, start: at(15), minutes: 60 },
  { title: "Haruka to Kansai Airport", kind: "transport", label: "train", place: "kyotoStation", destination: "kansaiAirport", start: at(9), minutes: 80 },
];

const ARCHIVE: SampleEvent[] = [
  { title: "Himeji Castle day trip", start: at(9), minutes: 240 },
  { title: "Kaiseki dinner", kind: "meal", start: at(18), minutes: 120 },
];

const TRIP_TODOS: { text: string; done?: true }[] = [
  { text: "Book Shinkansen seats", done: true },
  { text: "Buy ICOCA cards" },
  { text: "Reserve Pontocho dinner" },
];
const EVENT_TODOS: { event: string; text: string }[] = [
  { event: "fushimi", text: "Bring coins for offerings" },
  { event: "kiyomizu", text: "Check evening illumination hours" },
];

// The first date on or after `now` that falls on a Tuesday ("YYYY-MM-DD", UTC).
export function sampleStartDate(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + ((START_WEEKDAY - date.getUTCDay() + 7) % 7));
  return date.toISOString().slice(0, 10);
}

// The provider's ids of the places, found the first time and kept per provider (`key`): the pinned
// id when the provider knows it, else the first search hit for the name. A place the provider does not
// know leaves that Event without a place rather than failing the copy.
const found = new WeakMap<object, Map<PlaceKey, string>>();
async function resolvePlaces(deps: LegDeps, key: object): Promise<Map<PlaceKey, string>> {
  const known = found.get(key) ?? new Map<PlaceKey, string>();
  found.set(key, known);
  const missing = (Object.keys(SAMPLE_PLACES) as PlaceKey[]).filter((key) => !known.has(key));
  const ids = await Promise.all(
    missing.map(async (key) => {
      const { name, id } = SAMPLE_PLACES[key];
      try {
        if (id && (await deps.places.get(id))) return id;
        return (await deps.places.search(name))[0]?.id;
      } catch (err) {
        // A provider that is down leaves its Events without a place; they can be given one later.
        if (!isProviderError(err)) throw err;
        return undefined;
      }
    }),
  );
  missing.forEach((key, i) => {
    if (ids[i]) known.set(key, ids[i]);
  });
  return known;
}

const existingCopy = async (db: Db, userId: string) =>
  (await db.select({ id: trips.id }).from(trips).where(and(eq(trips.ownerId, userId), eq(trips.sampleOf, SAMPLE_KEY))))[0]?.id;

// The fixture as a Trip seed, with the provider's ids of its places.
function sampleSeed(ids: Map<PlaceKey, string>, now: Date): TripSeedInput {
  const placeOf = (key: PlaceKey | undefined) => (key ? (ids.get(key) ?? null) : null);
  const todosOf = (key: string | undefined) => EVENT_TODOS.filter((t) => key && t.event === key).map((t) => ({ text: t.text }));
  const event = (e: SampleEvent, scheduled: boolean): SeedEventInput => ({
    kind: e.kind ?? "attraction",
    title: e.title,
    transportLabel: e.label ?? null,
    nights: e.nights ?? null,
    // Check-in at 15:00 and check-out at 11:00, display only.
    checkInMinute: e.kind === "lodging" ? at(15) : null,
    checkOutMinute: e.kind === "lodging" ? at(11) : null,
    placeId: placeOf(e.place),
    destinationId: placeOf(e.destination),
    openingHoursOn: Boolean(e.hours && placeOf(e.place)),
    startMinute: e.start,
    durationMinutes: e.minutes,
    todos: todosOf(e.key),
    // A Leg between every two adjacent Events of a Day that both have a place.
    legToNext: scheduled ? (e.legMode ?? "transit") : null,
  });
  return {
    title: SAMPLE_TITLE,
    startDate: sampleStartDate(now),
    days: DAYS.map((list) => list.map((e) => event(e, true))),
    backlog: BACKLOG.map((e) => event(e, false)),
    archive: ARCHIVE.map((e) => event(e, false)),
    todos: TRIP_TODOS,
  };
}

// The user's copy of the sample Trip: the one they already have, else a new one made from the
// fixture. Two requests at once make one copy (the unique index on the owner and the sample).
// `providerKey` names the provider the found ids are kept for; the API passes the provider itself,
// since the one in `deps` is made for each request (to count its calls, plan step 33).
export async function openSampleTrip(
  db: Db,
  deps: LegDeps,
  userId: string,
  now = new Date(),
  providerKey: object = deps.places,
): Promise<{ tripId: string; created: boolean }> {
  const existing = await existingCopy(db, userId);
  if (existing) return { tripId: existing, created: false };

  const tripId = await writeTripSeed(db, deps, userId, sampleSeed(await resolvePlaces(deps, providerKey), now), { sampleOf: SAMPLE_KEY });
  // Another request made the copy first.
  if (!tripId) return { tripId: (await existingCopy(db, userId))!, created: false };
  return { tripId, created: true };
}
