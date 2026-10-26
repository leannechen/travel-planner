import { adjacentPairs, legEndpoints, tripSeedSchema, type SeedEvent, type TripSeedInput } from "@travel-planner/shared";
import type { Db } from "./db/client";
import { count, eq, sql } from "drizzle-orm";
import { days, eventImages, events, notes, todos, trips, users } from "./db/schema";
import { takeUserRoom } from "./limits";
import { prepareImage, type ImageStore, type PreparedImage } from "./images";
import { createLeg, isProviderError, type LegDeps } from "./legs";
import { getPlaces, uncachedPlaceIds } from "./places";

// A seed Event with the id it will have, made before anything is written.
type SeedEventWithId = SeedEvent & { id: string };

// An image of a seed that is not a JPEG, PNG or WebP picture.
export class SeedImageError extends Error {
  constructor(readonly eventTitle: string) {
    super(`The image of "${eventTitle}" is not a usable picture`);
  }
}

// A seed whose images would take the owner past the stored-image limit (the same limit as an upload).
export class SeedImageLimitError extends Error {
  constructor() {
    super("This backup has more pictures than you can keep");
  }
}

// Writes a new Trip from a seed (ADR 0008) and returns its id. With `sampleOf`, a user who already has
// a copy of that sample gets undefined and nothing is written (the unique index on the owner and
// the sample). Images in the seed (a backup) are checked and kept in `options.images`; one that is not
// a picture throws a SeedImageError before anything is written. With `options.maxImages`, a seed that
// would take the owner past it throws a SeedImageLimitError and nothing is written. Legs are made after the Trip is written; a provider that cannot be reached leaves a
// Leg out, and the user can add it later.
export async function writeTripSeed(
  db: Db,
  deps: LegDeps,
  ownerId: string,
  input: TripSeedInput,
  options: { sampleOf?: string; images?: ImageStore; maxImages?: { account: number; guest: number } } = {},
): Promise<string | undefined> {
  const seed = tripSeedSchema.parse(input);
  // Ids are made here so Todos and Legs can refer to their Events before anything is written.
  const withIds = (list: SeedEvent[]): SeedEventWithId[] => list.map((e) => ({ ...e, id: crypto.randomUUID() }));
  const dayLists = seed.days.map(withIds);
  const backlog = withIds(seed.backlog);
  const archive = withIds(seed.archive);
  const all = [...dayLists.flat(), ...backlog, ...archive];

  // Each image is checked like an upload and stored under its own id before the Trip is written; the
  // files are removed again if the Trip is not.
  const prepared = new Map<string, PreparedImage & { id: string }>();
  for (const e of all) {
    if (!e.image) continue;
    const image = await prepareImage(Buffer.from(e.image.data, "base64"));
    if (!image) throw new SeedImageError(e.title);
    prepared.set(e.id, { ...image, id: crypto.randomUUID() });
  }
  // A backup clearly over the limit is refused now, before any file is stored or place looked up; the
  // check is made again under the lock when the Trip is written.
  if (prepared.size > 0 && options.maxImages && (await overImageLimit(db, ownerId, prepared.size, options.maxImages))) throw new SeedImageLimitError();
  if (prepared.size > 0 && !options.images) throw new Error("A seed with images needs an image store");
  const storeImages = async () => {
    for (const image of prepared.values()) await options.images!.put(image.id, image.bytes);
  };
  const dropImages = () => Promise.allSettled([...prepared.values()].map((image) => options.images!.delete(image.id)));

  // Fetched now so the places are in the cache before anything asks for them.
  const placeIds = all.flatMap((e) => [e.placeId, e.destinationId].filter((id): id is string => id !== null));
  await getPlaces(db, deps.places, placeIds).catch((err: unknown) => {
    if (!isProviderError(err)) throw err;
  });

  // Lists are read in the order rows were made (`createdAt`, then id), and every row of one
  // transaction would get the same time, so each row is given its own millisecond in seed order,
  // ending now so a row the user adds next still comes after.
  const now = Date.now();
  const stamped = <T,>(rows: T[]) => rows.map((r, i) => ({ ...r, createdAt: new Date(now - rows.length + i) }));

  let tripId: string | undefined;
  try {
    await storeImages();
    tripId = await db.transaction(async (tx) => {
      await takeUserRoom(tx, ownerId);
      if (prepared.size > 0 && options.maxImages) {
        // The lock setEventImage takes, so an import and an upload at the same moment cannot go past the limit together.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"images:" + ownerId}))`);
        if (await overImageLimit(tx, ownerId, prepared.size, options.maxImages)) throw new SeedImageLimitError();
      }
      const [trip] = await tx
        .insert(trips)
        .values({ ownerId, title: seed.title, travelMode: seed.travelMode, startDate: seed.startDate, sampleOf: options.sampleOf ?? null })
        .onConflictDoNothing()
        .returning({ id: trips.id });
      if (!trip) return undefined;

      const dayRows = await tx
        .insert(days)
        .values(dayLists.map((_, i) => ({ tripId: trip.id, position: i + 1 })))
        .returning({ id: days.id, position: days.position });
      const dayId = (position: number) => dayRows.find((d) => d.position === position)!.id;

      const row = (e: SeedEventWithId, where: { dayId: string } | { holding: "backlog" | "archive" }) => ({
        id: e.id,
        tripId: trip.id,
        ...where,
        kind: e.kind,
        title: e.title,
        transportLabel: e.transportLabel,
        nights: e.nights,
        checkInMinute: e.checkInMinute,
        checkOutMinute: e.checkOutMinute,
        description: e.description,
        phone: e.phone,
        email: e.email,
        website: e.website,
        bookingUrl: e.bookingUrl,
        placeId: e.placeId,
        destinationId: e.destinationId,
        // Only an Event with a place has opening hours to show.
        openingHoursOn: e.openingHoursOn && e.placeId !== null,
        placePhotoHidden: e.placePhotoHidden,
        startMinute: e.startMinute,
        durationMinutes: e.durationMinutes,
      });
      const eventRows = [
        ...dayLists.flatMap((list, i) => list.map((e) => row(e, { dayId: dayId(i + 1) }))),
        ...backlog.map((e) => row(e, { holding: "backlog" })),
        ...archive.map((e) => row(e, { holding: "archive" })),
      ];
      if (eventRows.length > 0) await tx.insert(events).values(stamped(eventRows));

      // The image rows come after the Events they belong to, and the Events then point at them.
      for (const [eventId, image] of prepared) {
        await tx.insert(eventImages).values({ id: image.id, eventId, storageKey: image.id, contentType: image.contentType, byteSize: image.bytes.length, createdBy: ownerId });
        await tx.update(events).set({ imageId: image.id }).where(eq(events.id, eventId));
      }

      // The Notes panel lists by most recent edit, so the first Note of the seed gets the latest time.
      if (seed.notes.length > 0) {
        await tx.insert(notes).values(seed.notes.map((n, i) => ({ tripId: trip.id, ...n, updatedAt: new Date(now - i) })));
      }

      const todoRows = [
        ...seed.todos.map((t) => ({ tripId: trip.id, eventId: null, ...t, createdBy: ownerId })),
        ...all.flatMap((e) => e.todos.map((t) => ({ tripId: trip.id, eventId: e.id, ...t, createdBy: ownerId }))),
      ];
      if (todoRows.length > 0) await tx.insert(todos).values(stamped(todoRows));
      return trip.id;
    });
  } catch (err) {
    await dropImages();
    throw err;
  }
  if (!tripId) {
    await dropImages();
    return undefined;
  }

  await addLegs(db, deps, tripId, dayLists);
  return tripId;
}

// Whether the owner's stored images plus `adding` would pass the limit for their kind of user.
async function overImageLimit(db: Pick<Db, "select">, ownerId: string, adding: number, max: { account: number; guest: number }) {
  const [owner] = await db.select({ auth0Sub: users.auth0Sub }).from(users).where(eq(users.id, ownerId));
  const [kept] = await db
    .select({ n: count() })
    .from(eventImages)
    .innerJoin(events, eq(events.id, eventImages.eventId))
    .innerJoin(trips, eq(trips.id, events.tripId))
    .where(eq(trips.ownerId, ownerId));
  return (kept?.n ?? 0) + adding > (owner?.auth0Sub ? max.account : max.guest);
}

// The Legs a seed asks for: from every Event with `legToNext` to the next adjacent Event of its Day,
// when both have a place. Lodging is a banner, not on the timeline, so it has no Legs.
function legsAskedFor(dayLists: SeedEventWithId[][]) {
  return dayLists.flatMap((list) =>
    adjacentPairs(list.filter((e) => e.kind !== "lodging")).flatMap(([from, to]) => {
      const { fromPlaceId, toPlaceId } = legEndpoints(from, to);
      return from.legToNext && fromPlaceId && toPlaceId ? [{ input: { fromEventId: from.id, toEventId: to.id, mode: from.legToNext }, placeIds: [fromPlaceId, toPlaceId] }] : [];
    }),
  );
}

async function addLegs(db: Db, deps: LegDeps, tripId: string, dayLists: SeedEventWithId[][]) {
  for (const leg of legsAskedFor(dayLists)) {
    try {
      await createLeg(db, deps, tripId, leg.input);
    } catch (err) {
      if (!isProviderError(err)) throw err;
    }
  }
}

// At most how many provider lookups writing the seed takes (plan step 33): one per place that is not
// cached, and per Leg one for the travel time (which may be cached) and one for each of its places
// that is still not cached then (a place the provider does not know is asked about again).
export async function seedLookupCost(db: Db, input: TripSeedInput): Promise<number> {
  const seed = tripSeedSchema.parse(input);
  const all = [...seed.days.flat(), ...seed.backlog, ...seed.archive];
  const placeIds = all.flatMap((e) => [e.placeId, e.destinationId].filter((id): id is string => id !== null));
  const dayLists = seed.days.map((list) => list.map((e, i) => ({ ...e, id: String(i) })));
  const uncached = new Set(await uncachedPlaceIds(db, placeIds));
  return legsAskedFor(dayLists).reduce((n, leg) => n + 1 + leg.placeIds.filter((id) => uncached.has(id)).length, uncached.size);
}
