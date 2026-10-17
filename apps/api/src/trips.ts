import type { CreateEventInput, CreateTripInput, Event, Trip } from "@travel-planner/shared";
import { and, asc, desc, eq } from "drizzle-orm";
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
            orderBy: [asc(events.createdAt), asc(events.id)],
            columns: { id: true, dayId: true, title: true },
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
export async function addEvent(
  db: Db,
  ownerId: string,
  tripId: string,
  dayId: string,
  input: CreateEventInput,
): Promise<Event | undefined> {
  const [day] = await db
    .select({ id: days.id })
    .from(days)
    .innerJoin(trips, eq(days.tripId, trips.id))
    .where(and(eq(days.id, dayId), eq(trips.id, tripId), eq(trips.ownerId, ownerId)));
  if (!day) return undefined;

  const [event] = await db.insert(events).values({ dayId, title: input.title }).returning();
  return { id: event!.id, dayId: event!.dayId, title: event!.title };
}
