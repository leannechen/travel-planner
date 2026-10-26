import { MAX_SEED_DAYS, MAX_SEED_EVENTS, MAX_SEED_NOTES, MAX_SEED_TODOS, MAX_TRIPS } from "@travel-planner/shared";
import { count, eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { days, events, notes, todos, trips, users } from "./db/schema";

type Q = Pick<Db, "select" | "execute">;

// Something a user or a Trip cannot have more of: Trips for a user, Days, Events, Todos or Notes in
// a Trip. The writers throw it inside their transaction (so nothing is written) and the error
// handler answers 409 `limit_reached`.
export class LimitReached extends Error {
  constructor(readonly what: "trips" | "days" | "events" | "todos" | "notes") {
    super(`The limit of ${what} is reached`);
  }
}

// A Trip holds as much as a backup import may bring in (the sizes in tripSeedSchema).
const TRIP_LIMITS = { days: MAX_SEED_DAYS, events: MAX_SEED_EVENTS, todos: MAX_SEED_TODOS, notes: MAX_SEED_NOTES };
const counted = {
  days: (q: Q, tripId: string) => q.select({ n: count() }).from(days).where(eq(days.tripId, tripId)),
  events: (q: Q, tripId: string) => q.select({ n: count() }).from(events).where(eq(events.tripId, tripId)),
  todos: (q: Q, tripId: string) => q.select({ n: count() }).from(todos).where(eq(todos.tripId, tripId)),
  notes: (q: Q, tripId: string) => q.select({ n: count() }).from(notes).where(eq(notes.tripId, tripId)),
};

// Makes room for `adding` more of `what` in the Trip, or throws LimitReached. Call it in the
// transaction that writes them: the lock keeps two requests at the same moment from going past the
// limit together.
export async function takeTripRoom(q: Q, tripId: string, what: keyof typeof TRIP_LIMITS, adding = 1): Promise<void> {
  await q.execute(sql`select pg_advisory_xact_lock(hashtext(${"size:" + tripId}))`);
  const [row] = await counted[what](q, tripId);
  if ((row?.n ?? 0) + adding > TRIP_LIMITS[what]) throw new LimitReached(what);
}

// The same for the Trips a user owns (accounts may have more than guests). Call it in the
// transaction that writes the Trip.
export async function takeUserRoom(q: Q, userId: string): Promise<void> {
  await q.execute(sql`select pg_advisory_xact_lock(hashtext(${"trips:" + userId}))`);
  if (!(await hasUserRoom(q, userId))) throw new LimitReached("trips");
}

// Whether the user can have one more Trip. For a quick refusal before work that would be wasted;
// the writer still checks under the lock.
export async function hasUserRoom(q: Pick<Db, "select">, userId: string): Promise<boolean> {
  const [owner] = await q.select({ auth0Sub: users.auth0Sub }).from(users).where(eq(users.id, userId));
  const [kept] = await q.select({ n: count() }).from(trips).where(eq(trips.ownerId, userId));
  return (kept?.n ?? 0) + 1 <= (owner?.auth0Sub ? MAX_TRIPS.account : MAX_TRIPS.guest);
}
