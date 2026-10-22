import { adjacentPairs, legEndpoints, tripSeedSchema, type SeedEvent, type TripSeedInput } from "@travel-planner/shared";
import type { Db } from "./db/client";
import { days, events, todos, trips } from "./db/schema";
import { createLeg, isProviderError, type LegDeps } from "./legs";
import { getPlaces } from "./places";

// A seed Event with the id it will have, made before anything is written.
type SeedEventWithId = SeedEvent & { id: string };

// Writes a new Trip from a seed (ADR 0008) and returns its id. With `sampleOf`, a user who already has
// a copy of that sample gets undefined and nothing is written (the unique index on the owner and
// the sample). Legs are made after the Trip is written; a provider that cannot be reached leaves a
// Leg out, and the user can add it later.
export async function writeTripSeed(
  db: Db,
  deps: LegDeps,
  ownerId: string,
  input: TripSeedInput,
  options: { sampleOf?: string } = {},
): Promise<string | undefined> {
  const seed = tripSeedSchema.parse(input);
  // Ids are made here so Todos and Legs can refer to their Events before anything is written.
  const withIds = (list: SeedEvent[]): SeedEventWithId[] => list.map((e) => ({ ...e, id: crypto.randomUUID() }));
  const dayLists = seed.days.map(withIds);
  const backlog = withIds(seed.backlog);
  const archive = withIds(seed.archive);
  const all = [...dayLists.flat(), ...backlog, ...archive];

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

  const tripId = await db.transaction(async (tx) => {
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

    const todoRows = [
      ...seed.todos.map((t) => ({ tripId: trip.id, eventId: null, ...t, createdBy: ownerId })),
      ...all.flatMap((e) => e.todos.map((t) => ({ tripId: trip.id, eventId: e.id, ...t, createdBy: ownerId }))),
    ];
    if (todoRows.length > 0) await tx.insert(todos).values(stamped(todoRows));
    return trip.id;
  });
  if (!tripId) return undefined;

  await addLegs(db, deps, tripId, dayLists);
  return tripId;
}

// A Leg from every Event that asks for one to the next adjacent Event of its Day, when both have a
// place. Lodging is a banner, not on the timeline, so it has no Legs.
async function addLegs(db: Db, deps: LegDeps, tripId: string, dayLists: SeedEventWithId[][]) {
  for (const list of dayLists) {
    for (const [from, to] of adjacentPairs(list.filter((e) => e.kind !== "lodging"))) {
      const { fromPlaceId, toPlaceId } = legEndpoints(from, to);
      if (!from.legToNext || !fromPlaceId || !toPlaceId) continue;
      try {
        await createLeg(db, deps, tripId, { fromEventId: from.id, toEventId: to.id, mode: from.legToNext });
      } catch (err) {
        if (!isProviderError(err)) throw err;
      }
    }
  }
}
