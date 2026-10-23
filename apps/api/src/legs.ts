import {
  adjacentPairs,
  legEndpoints,
  type CreateLegInput,
  type Leg,
  type Place,
  type TravelMode,
} from "@travel-planner/shared";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { days, events, legs, trips } from "./db/schema";
import { getPlaces, PlaceProviderError, type PlaceProvider } from "./places";
import { routeBetween, RouteProviderError, type Departure, type RouteProvider } from "./routes";
import { UsageLimitError } from "./usage";

export type LegDeps = { places: PlaceProvider; routes: RouteProvider };

type Calculated = { durationMinutes: number | null; distanceMeters: number | null };
const CANNOT_CALCULATE: Calculated = { durationMinutes: null, distanceMeters: null };

const toLeg = (row: typeof legs.$inferSelect): Leg => ({
  id: row.id,
  dayId: row.dayId,
  fromEventId: row.fromEventId,
  toEventId: row.toEventId,
  mode: row.mode,
  durationMinutes: row.durationMinutes,
  distanceMeters: row.distanceMeters,
});

export async function listLegs(db: Db, tripId: string): Promise<Leg[]> {
  return (await db.select().from(legs).where(eq(legs.tripId, tripId)).orderBy(legs.id)).map(toLeg);
}

// A database or a transaction on it.
type Executor = Pick<Db, "select" | "execute">;

// The Events a Day's timeline shows (Lodging is a banner), as the Legs see them.
function dayEvents(db: Executor, tripId: string) {
  return db
    .select({
      id: events.id,
      dayId: events.dayId,
      kind: events.kind,
      startMinute: events.startMinute,
      durationMinutes: events.durationMinutes,
      placeId: events.placeId,
      destinationId: events.destinationId,
    })
    .from(events)
    .where(and(eq(events.tripId, tripId), isNotNull(events.dayId), ne(events.kind, "lodging")));
}

type DayEvent = Awaited<ReturnType<typeof dayEvents>>[number];

const MINUTE_MS = 60_000;
const WEEK_MS = 7 * 24 * 60 * MINUTE_MS;

// When the traveller leaves the Event `from`: the end of it, on its Day, by the clock of the place
// (a Day is a calendar date and an Event a time on it, ADR 0001). None when the Trip has no start
// date or the place has no time zone. A time already past moves to the same weekday and hour of a
// later week, because the route provider only plans departures from now on.
async function departureOf(db: Db, from: DayEvent, place: Place, now = new Date()): Promise<Departure | undefined> {
  if (!from.dayId || place.utcOffsetMinutes === undefined) return undefined;
  const [day] = await db
    .select({ position: days.position, startDate: trips.startDate })
    .from(days)
    .innerJoin(trips, eq(trips.id, days.tripId))
    .where(eq(days.id, from.dayId));
  if (!day?.startDate) return undefined;
  const endMinute = from.startMinute + from.durationMinutes;
  const local = Date.parse(`${day.startDate}T00:00:00Z`) + (day.position - 1) * 24 * 60 * MINUTE_MS + endMinute * MINUTE_MS;
  let at = local - place.utcOffsetMinutes * MINUTE_MS;
  if (at <= now.getTime()) at += Math.ceil((now.getTime() - at + MINUTE_MS) / WEEK_MS) * WEEK_MS;
  return { at: new Date(at), localHour: Math.floor((((endMinute % 1440) + 1440) % 1440) / 60) };
}

// Travel time between two places by `mode`. Missing places or no route mean it cannot be
// calculated. A provider that cannot be reached throws.
async function calculate(
  db: Db,
  deps: LegDeps,
  mode: TravelMode,
  fromPlaceId: string | null,
  toPlaceId: string | null,
  leaving?: DayEvent,
): Promise<Calculated> {
  if (!fromPlaceId || !toPlaceId) return CANNOT_CALCULATE;
  const found = await getPlaces(db, deps.places, [fromPlaceId, toPlaceId]);
  const byId = new Map<string, Place>(found.map((p) => [p.id, p]));
  const from = byId.get(fromPlaceId);
  const to = byId.get(toPlaceId);
  if (!from || !to) return CANNOT_CALCULATE;
  const departure = leaving && mode === "transit" ? await departureOf(db, leaving, from) : undefined;
  return (await routeBetween(db, deps.routes, from, to, mode, departure)) ?? CANNOT_CALCULATE;
}

// Whether the error is the provider being unavailable (as opposed to a bug); a call refused by the
// usage limits counts too, so it leaves a Leg uncalculated like an unreachable provider does.
export const isProviderError = (err: unknown) => err instanceof PlaceProviderError || err instanceof RouteProviderError || err instanceof UsageLimitError;

// The Events of each Day, ready for the adjacency check.
function byDay(all: DayEvent[]): DayEvent[][] {
  const groups = new Map<string | null, DayEvent[]>();
  for (const e of all) groups.set(e.dayId, [...(groups.get(e.dayId) ?? []), e]);
  return [...groups.values()];
}

const pairKey = (from: string, to: string) => `${from}>${to}`;

export type CreatedLeg = Leg | "not-adjacent" | "no-location" | "exists";

// The two Events when they are adjacent in a Day.
async function findPair(db: Executor, tripId: string, input: CreateLegInput): Promise<[DayEvent, DayEvent] | undefined> {
  for (const dayList of byDay(await dayEvents(db, tripId))) {
    const pair = adjacentPairs(dayList).find(([a, b]) => a.id === input.fromEventId && b.id === input.toEventId);
    if (pair) return pair;
  }
  return undefined;
}

// Changes to a Trip's Legs and to the Events they depend on are ordered by a lock on the Trip row:
// a Leg is created only after the lock is held and adjacency checked again, and the sync after an
// Event change takes the same lock, so no Leg is left between Events that are no longer adjacent.
const lockTrip = (tx: Executor, tripId: string) => tx.execute(sql`select 1 from ${trips} where ${trips.id} = ${tripId} for update`);

// Creates the Leg between two adjacent Events (ADR 0002). Both Events need a location; a Leg
// already created shows "cannot calculate" if one is cleared later.
export async function createLeg(db: Db, deps: LegDeps, tripId: string, input: CreateLegInput): Promise<CreatedLeg> {
  const pair = await findPair(db, tripId, input);
  if (!pair) return "not-adjacent";
  const { fromPlaceId, toPlaceId } = legEndpoints(...pair);
  if (!fromPlaceId || !toPlaceId) return "no-location";
  const [already] = await db
    .select({ id: legs.id })
    .from(legs)
    .where(and(eq(legs.fromEventId, input.fromEventId), eq(legs.toEventId, input.toEventId)));
  if (already) return "exists";
  // The slow part (the provider can take seconds) is done before the lock is taken.
  const result = await calculate(db, deps, input.mode, fromPlaceId, toPlaceId, pair[0]);
  return db.transaction(async (tx) => {
    await lockTrip(tx, tripId);
    const current = await findPair(tx, tripId, input);
    if (!current) return "not-adjacent";
    const now = legEndpoints(...current);
    if (!now.fromPlaceId || !now.toPlaceId) return "no-location";
    // The places changed while calculating: keep the Leg, but unknown, so the next sync calculates it.
    const fresh = now.fromPlaceId === fromPlaceId && now.toPlaceId === toPlaceId;
    const [row] = await tx
      .insert(legs)
      .values({
        tripId,
        dayId: current[0].dayId!,
        fromEventId: current[0].id,
        toEventId: current[1].id,
        mode: input.mode,
        ...(fresh ? { ...result, fromPlaceId, toPlaceId } : { ...CANNOT_CALCULATE, fromPlaceId: null, toPlaceId: null }),
      })
      .onConflictDoNothing()
      .returning();
    // Two requests for the same pair at once: the other one created it.
    return row ? toLeg(row) : "exists";
  });
}

// Changes a Leg's travel mode and calculates it again, from where its Events are now.
export async function setLegMode(db: Db, deps: LegDeps, tripId: string, legId: string, mode: TravelMode): Promise<Leg | undefined> {
  const [row] = await db.select().from(legs).where(and(eq(legs.id, legId), eq(legs.tripId, tripId)));
  if (!row) return undefined;
  const onDays = await dayEvents(db, tripId);
  const from = onDays.find((e) => e.id === row.fromEventId);
  const to = onDays.find((e) => e.id === row.toEventId);
  if (!from || !to) return undefined;
  const { fromPlaceId, toPlaceId } = legEndpoints(from, to);
  const result = await calculate(db, deps, mode, fromPlaceId, toPlaceId, from);
  const [updated] = await db.update(legs).set({ mode, ...result, fromPlaceId, toPlaceId }).where(eq(legs.id, legId)).returning();
  return updated && toLeg(updated);
}

export async function deleteLeg(db: Db, tripId: string, legId: string): Promise<boolean> {
  const deleted = await db.delete(legs).where(and(eq(legs.id, legId), eq(legs.tripId, tripId))).returning({ id: legs.id });
  return deleted.length > 0;
}

// Brings a Trip's Legs in line with its Events (PRD §3.3, Leg lifecycle), after Events or Days
// changed: a Leg whose Events are no longer adjacent is removed; one whose places changed is
// calculated again. Events leaving a Day (archived, moved to the Backlog, deleted) are covered by
// the adjacency check, so no Leg outlives them. Never throws: when the provider is unavailable
// the Leg shows "cannot calculate" and is tried again at the next change.
export async function syncLegs(db: Db, deps: LegDeps, tripId: string): Promise<void> {
  const kept = await db.transaction(async (tx) => {
    await lockTrip(tx, tripId);
    const stored = await tx.select().from(legs).where(eq(legs.tripId, tripId));
    if (stored.length === 0) return [];
    const all = await dayEvents(tx, tripId);
    const adjacent = new Set<string>();
    for (const dayList of byDay(all)) {
      for (const [a, b] of adjacentPairs(dayList)) adjacent.add(pairKey(a.id, b.id));
    }
    const gone = stored.filter((leg) => !adjacent.has(pairKey(leg.fromEventId, leg.toEventId)));
    if (gone.length > 0) await tx.delete(legs).where(inArray(legs.id, gone.map((leg) => leg.id)));
    const byId = new Map(all.map((e) => [e.id, e]));
    return stored
      .filter((l) => adjacent.has(pairKey(l.fromEventId, l.toEventId)))
      .map((leg) => ({ leg, from: byId.get(leg.fromEventId)!, ...legEndpoints(byId.get(leg.fromEventId)!, byId.get(leg.toEventId)!) }));
  });

  for (const { leg, from, fromPlaceId, toPlaceId } of kept) {
    if (fromPlaceId === leg.fromPlaceId && toPlaceId === leg.toPlaceId) continue;
    try {
      const result = await calculate(db, deps, leg.mode, fromPlaceId, toPlaceId, from);
      await db.update(legs).set({ ...result, fromPlaceId, toPlaceId }).where(eq(legs.id, leg.id));
    } catch (err) {
      if (!isProviderError(err)) throw err;
      // Unknown places mark the Leg as stale: whatever the Events look like at the next sync, it
      // is calculated again.
      await db.update(legs).set({ ...CANNOT_CALCULATE, fromPlaceId: null, toPlaceId: null }).where(eq(legs.id, leg.id));
    }
  }
}
