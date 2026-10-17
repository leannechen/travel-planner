import {
  insertAt,
  isReorderOf,
  removeId,
  type CreateEventInput,
  type CreateTripInput,
  type Day,
  type Event,
  type Trip,
} from "@travel-planner/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { days, events, trips } from "./db/schema";

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
            columns: { id: true, dayId: true, title: true, startMinute: true, durationMinutes: true },
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
): Promise<Event | undefined> {
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

    const [event] = await tx.insert(events).values({ dayId, title: input.title, startMinute: input.startMinute, durationMinutes: input.durationMinutes }).returning();
    return {
      id: event!.id,
      dayId: event!.dayId,
      title: event!.title,
      startMinute: event!.startMinute,
      durationMinutes: event!.durationMinutes,
    };
  });
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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
        columns: { id: true, dayId: true, title: true, startMinute: true, durationMinutes: true },
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

    // Created past the end, then renumbered into place.
    const [day] = await tx
      .insert(days)
      .values({ tripId, position: ids.length + 1 })
      .returning({ id: days.id });
    await applyDayOrder(tx, tripId, insertAt(ids, day!.id, position));
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

    await applyDayOrder(tx, tripId, dayIds);
    return loadDays(tx, tripId);
  });
}

// Only an empty Day can be deleted, and a Trip always keeps at least one Day.
export async function deleteDay(
  db: Db,
  ownerId: string,
  tripId: string,
  dayId: string,
): Promise<Day[] | undefined | "not-empty" | "last-day"> {
  return db.transaction(async (tx) => {
    const ids = await lockTripDays(tx, ownerId, tripId);
    if (!ids?.includes(dayId)) return undefined;
    if (ids.length === 1) return "last-day";

    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.dayId, dayId)).limit(1);
    if (event) return "not-empty";

    await tx.delete(days).where(eq(days.id, dayId));
    await applyDayOrder(tx, tripId, removeId(ids, dayId));
    return loadDays(tx, tripId);
  });
}
