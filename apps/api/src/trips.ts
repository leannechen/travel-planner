import {
  insertAt,
  isReorderOf,
  lodgingAfterDelete,
  lodgingAfterInsert,
  lodgingFits,
  removeId,
  type Stay,
  type CreateEventInput,
  type CreateTripInput,
  type Day,
  type Event,
  type Trip,
  type UpdateEventInput,
} from "@travel-planner/shared";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { days, events, trips } from "./db/schema";

function toEvent(row: typeof events.$inferSelect): Event {
  return {
    id: row.id,
    dayId: row.dayId,
    kind: row.kind,
    title: row.title,
    startMinute: row.startMinute,
    durationMinutes: row.durationMinutes,
    transportLabel: row.transportLabel,
    nights: row.nights,
    checkInMinute: row.checkInMinute,
    checkOutMinute: row.checkOutMinute,
    description: row.description,
    phone: row.phone,
    email: row.email,
    website: row.website,
    bookingUrl: row.bookingUrl,
  };
}

const eventColumns = {
  id: true,
  dayId: true,
  kind: true,
  title: true,
  startMinute: true,
  durationMinutes: true,
  transportLabel: true,
  nights: true,
  checkInMinute: true,
  checkOutMinute: true,
  description: true,
  phone: true,
  email: true,
  website: true,
  bookingUrl: true,
} as const;

export async function listTrips(db: Db, ownerId: string): Promise<Trip[]> {
  return db.query.trips.findMany({
    where: eq(trips.ownerId, ownerId),
    orderBy: [desc(trips.createdAt), desc(trips.id)],
    columns: { id: true, title: true },
    with: {
      days: {
        orderBy: asc(days.position),
        columns: { id: true, position: true },
        with: {
          events: {
            orderBy: [asc(events.startMinute), asc(events.createdAt), asc(events.id)],
            columns: eventColumns,
          },
        },
      },
    },
  });
}

export async function createTrip(db: Db, ownerId: string, input: CreateTripInput): Promise<Trip> {
  return db.transaction(async (tx) => {
    const [trip] = await tx.insert(trips).values({ ownerId, title: input.title }).returning();
    const [day] = await tx.insert(days).values({ tripId: trip!.id, position: 1 }).returning();
    return {
      id: trip!.id,
      title: trip!.title,
      days: [{ id: day!.id, position: day!.position, events: [] }],
    };
  });
}

// Returns undefined when the Day is not in a Trip owned by this user.
// Takes a shared lock on the Trip row, so it cannot interleave with a Day change (which holds the
// exclusive lock); otherwise an Event added while its Day is being deleted would be cascaded away.
export async function addEvent(
  db: Db,
  ownerId: string,
  tripId: string,
  dayId: string,
  input: CreateEventInput,
): Promise<Event | undefined | "invalid-lodging"> {
  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.ownerId, ownerId)))
      .for("share");
    if (!trip) return undefined;

    // A separate statement: it must see the Days as they are after the lock was granted.
    const [day] = await tx
      .select({ id: days.id })
      .from(days)
      .where(and(eq(days.id, dayId), eq(days.tripId, tripId)));
    if (!day) return undefined;
    if (input.kind === "lodging" && !(await stayFits(tx, tripId, dayId, input.nights))) return "invalid-lodging";

    const [event] = await tx.insert(events).values({ dayId, ...input }).returning();
    return toEvent(event!);
  });
}

// Changes the given fields of an Event; `dayId` moves it to another Day of the same Trip.
// Returns undefined when the Event is not in a Trip owned by this user, and "invalid-day" when
// the target Day is not in the Trip. Takes the same shared Trip lock as addEvent.
export async function updateEvent(
  db: Db,
  ownerId: string,
  tripId: string,
  eventId: string,
  input: UpdateEventInput,
): Promise<Event | undefined | "invalid-day" | "invalid-lodging"> {
  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.ownerId, ownerId)))
      .for("share");
    if (!trip) return undefined;

    const [current] = await tx
      .select({ id: events.id, kind: events.kind, nights: events.nights, dayId: events.dayId })
      .from(events)
      .innerJoin(days, eq(events.dayId, days.id))
      .where(and(eq(events.id, eventId), eq(days.tripId, tripId)))
      // So two updates of one Event run one after another, each checking the latest values.
      .for("update", { of: events });
    if (!current) return undefined;

    if (input.dayId) {
      const [target] = await tx
        .select({ id: days.id })
        .from(days)
        .where(and(eq(days.id, input.dayId), eq(days.tripId, tripId)));
      if (!target) return "invalid-day";
    }

    const kind = input.kind ?? current.kind;
    const nights = input.nights !== undefined ? input.nights : current.nights;
    if (kind === "lodging" && !(await stayFits(tx, tripId, input.dayId ?? current.dayId, nights))) {
      return "invalid-lodging";
    }

    const [event] = await tx.update(events).set(input).where(eq(events.id, eventId)).returning();
    return toEvent(event!);
  });
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Whether a stay starting on this Day has at least one night and every night on a Day of the Trip.
async function stayFits(tx: Tx, tripId: string, checkInDayId: string, nights: number | null | undefined) {
  if (!nights) return false;
  const rows = await tx.select({ id: days.id, position: days.position }).from(days).where(eq(days.tripId, tripId));
  const checkIn = rows.find((r) => r.id === checkInDayId);
  return !!checkIn && lodgingFits({ checkInPosition: checkIn.position, nights }, rows.length);
}

type PlacedStay = { id: string; stay: Stay };

// The Trip's Lodgings with the position of their check-in Day, as it is now.
async function loadStays(tx: Tx, tripId: string): Promise<PlacedStay[]> {
  const rows = await tx
    .select({ id: events.id, nights: events.nights, position: days.position })
    .from(events)
    .innerJoin(days, eq(events.dayId, days.id))
    .where(and(eq(days.tripId, tripId), eq(events.kind, "lodging")));
  return rows.flatMap((r) => (r.nights ? [{ id: r.id, stay: { checkInPosition: r.position, nights: r.nights } }] : []));
}

// Writes each stay's nights and points it at the Day that now holds its check-in position.
async function placeStays(tx: Tx, orderedIds: string[], stays: PlacedStay[]) {
  for (const { id, stay } of stays) {
    await tx.update(events).set({ nights: stay.nights, dayId: orderedIds[stay.checkInPosition - 1]! }).where(eq(events.id, id));
  }
}

// Locks the Trip row so concurrent Day changes on one Trip run one after another.
// Returns the Trip's Day ids in position order, or undefined when the user does not own the Trip.
async function lockTripDays(tx: Tx, ownerId: string, tripId: string): Promise<string[] | undefined> {
  const [trip] = await tx
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.ownerId, ownerId)))
    .for("update");
  if (!trip) return undefined;
  const rows = await tx
    .select({ id: days.id })
    .from(days)
    .where(eq(days.tripId, tripId))
    .orderBy(asc(days.position));
  return rows.map((r) => r.id);
}

// Makes positions 1..N follow `orderedIds`. The unique (tripId, position) constraint is checked
// per row, so positions are first moved out of the way (negated) and then written back.
async function applyDayOrder(tx: Tx, tripId: string, orderedIds: string[]) {
  await tx.update(days).set({ position: sql`-${days.position}` }).where(eq(days.tripId, tripId));
  for (const [index, id] of orderedIds.entries()) {
    await tx.update(days).set({ position: index + 1 }).where(eq(days.id, id));
  }
}

async function loadDays(tx: Tx, tripId: string): Promise<Day[]> {
  return tx.query.days.findMany({
    where: eq(days.tripId, tripId),
    orderBy: asc(days.position),
    columns: { id: true, position: true },
    with: {
      events: {
        orderBy: [asc(events.startMinute), asc(events.createdAt), asc(events.id)],
        columns: eventColumns,
      },
    },
  });
}

// Each Day function returns the Trip's Days after the change, or undefined when the user does
// not own the Trip (or, for deletion, the Day is not in it).

// Inserts a new empty Day at `position` (1..N+1); later Days are renumbered.
export async function insertDay(
  db: Db,
  ownerId: string,
  tripId: string,
  position: number,
): Promise<Day[] | undefined | "invalid-position"> {
  return db.transaction(async (tx) => {
    const ids = await lockTripDays(tx, ownerId, tripId);
    if (!ids) return undefined;
    if (position > ids.length + 1) return "invalid-position";

    const stays = await loadStays(tx, tripId);
    // Created past the end, then renumbered into place.
    const [day] = await tx
      .insert(days)
      .values({ tripId, position: ids.length + 1 })
      .returning({ id: days.id });
    const order = insertAt(ids, day!.id, position);
    await applyDayOrder(tx, tripId, order);
    await placeStays(tx, order, stays.map(({ id, stay }) => ({ id, stay: lodgingAfterInsert(stay, position, ids.length) })));
    return loadDays(tx, tripId);
  });
}

// `dayIds` must be exactly the Trip's Day ids in the new order.
export async function reorderDays(
  db: Db,
  ownerId: string,
  tripId: string,
  dayIds: string[],
): Promise<Day[] | undefined | "invalid-order"> {
  return db.transaction(async (tx) => {
    const ids = await lockTripDays(tx, ownerId, tripId);
    if (!ids) return undefined;
    if (!isReorderOf(ids, dayIds)) return "invalid-order";

    // A stay is tied to positions, so it stays where it is and points at the Day now there.
    const stays = await loadStays(tx, tripId);
    await applyDayOrder(tx, tripId, dayIds);
    await placeStays(tx, dayIds, stays);
    return loadDays(tx, tripId);
  });
}

// Only an empty Day can be deleted, and a Trip always keeps at least one Day.
export async function deleteDay(
  db: Db,
  ownerId: string,
  tripId: string,
  dayId: string,
): Promise<Day[] | undefined | "not-empty" | "last-day" | "lodging-would-end"> {
  return db.transaction(async (tx) => {
    const ids = await lockTripDays(tx, ownerId, tripId);
    if (!ids?.includes(dayId)) return undefined;
    if (ids.length === 1) return "last-day";

    // A check-in alone does not make a Day non-empty; the stay is adjusted instead.
    const [event] = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.dayId, dayId), ne(events.kind, "lodging")))
      .limit(1);
    if (event) return "not-empty";

    const position = ids.indexOf(dayId) + 1;
    const adjusted: PlacedStay[] = [];
    for (const { id, stay } of await loadStays(tx, tripId)) {
      const result = lodgingAfterDelete(stay, position);
      if (result === "empty") return "lodging-would-end"; // moves to the Backlog once step 8 exists
      adjusted.push({ id, stay: result });
    }

    const order = removeId(ids, dayId);
    // Before the Day is deleted, so no stay is cascaded away with it.
    await placeStays(tx, order, adjusted);
    await tx.delete(days).where(eq(days.id, dayId));
    await applyDayOrder(tx, tripId, order);
    return loadDays(tx, tripId);
  });
}
