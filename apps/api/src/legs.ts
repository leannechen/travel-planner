import {
  adjacentPairs,
  legEndpoints,
  type CreateLegInput,
  type Leg,
  type Place,
  type TravelMode,
} from "@travel-planner/shared";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { Db } from "./db/client";
import { events, legs } from "./db/schema";
import { getPlaces, PlaceProviderError, type PlaceProvider } from "./places";
import { routeBetween, RouteProviderError, type RouteProvider } from "./routes";

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

// The Events a Day's timeline shows (Lodging is a banner), as the Legs see them.
function dayEvents(db: Db, tripId: string) {
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

// Travel time between two places by `mode`. Missing places or no route mean it cannot be
// calculated. A provider that cannot be reached throws.
async function calculate(
  db: Db,
  deps: LegDeps,
  mode: TravelMode,
  fromPlaceId: string | null,
  toPlaceId: string | null,
): Promise<Calculated> {
  if (!fromPlaceId || !toPlaceId) return CANNOT_CALCULATE;
  const found = await getPlaces(db, deps.places, [fromPlaceId, toPlaceId]);
  const byId = new Map<string, Place>(found.map((p) => [p.id, p]));
  const from = byId.get(fromPlaceId);
  const to = byId.get(toPlaceId);
  if (!from || !to) return CANNOT_CALCULATE;
  return (await routeBetween(db, deps.routes, from, to, mode)) ?? CANNOT_CALCULATE;
}

// Whether the error is the provider being unavailable (as opposed to a bug).
export const isProviderError = (err: unknown) => err instanceof PlaceProviderError || err instanceof RouteProviderError;

// The Events of each Day, ready for the adjacency check.
function byDay(all: DayEvent[]): DayEvent[][] {
  const groups = new Map<string | null, DayEvent[]>();
  for (const e of all) groups.set(e.dayId, [...(groups.get(e.dayId) ?? []), e]);
  return [...groups.values()];
}

const pairKey = (from: string, to: string) => `${from}>${to}`;

export type CreatedLeg = Leg | "not-adjacent" | "exists";

// Creates the Leg between two adjacent Events (ADR 0002). A Leg whose Events have no location is
// created too, and shows "cannot calculate".
export async function createLeg(db: Db, deps: LegDeps, tripId: string, input: CreateLegInput): Promise<CreatedLeg> {
  const all = await dayEvents(db, tripId);
  let pair: [DayEvent, DayEvent] | undefined;
  for (const dayList of byDay(all)) {
    pair = adjacentPairs(dayList).find(([a, b]) => a.id === input.fromEventId && b.id === input.toEventId);
    if (pair) break;
  }
  if (!pair) return "not-adjacent";
  const [from, to] = pair;
  const [already] = await db
    .select({ id: legs.id })
    .from(legs)
    .where(and(eq(legs.fromEventId, from.id), eq(legs.toEventId, to.id)));
  if (already) return "exists";
  const { fromPlaceId, toPlaceId } = legEndpoints(from, to);
  const result = await calculate(db, deps, input.mode, fromPlaceId, toPlaceId);
  const [row] = await db
    .insert(legs)
    .values({ tripId, dayId: from.dayId!, fromEventId: from.id, toEventId: to.id, mode: input.mode, ...result, fromPlaceId, toPlaceId })
    .onConflictDoNothing()
    .returning();
  // Two requests for the same pair at once: the other one created it.
  return row ? toLeg(row) : "exists";
}

// Changes a Leg's travel mode and calculates it again.
export async function setLegMode(db: Db, deps: LegDeps, tripId: string, legId: string, mode: TravelMode): Promise<Leg | undefined> {
  const [row] = await db.select().from(legs).where(and(eq(legs.id, legId), eq(legs.tripId, tripId)));
  if (!row) return undefined;
  const result = await calculate(db, deps, mode, row.fromPlaceId, row.toPlaceId);
  const [updated] = await db.update(legs).set({ mode, ...result }).where(eq(legs.id, legId)).returning();
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
  const stored = await db.select().from(legs).where(eq(legs.tripId, tripId));
  if (stored.length === 0) return;
  const all = await dayEvents(db, tripId);
  const byId = new Map(all.map((e) => [e.id, e]));
  const adjacent = new Set<string>();
  for (const dayList of byDay(all)) {
    for (const [a, b] of adjacentPairs(dayList)) adjacent.add(pairKey(a.id, b.id));
  }

  const gone = stored.filter((leg) => !adjacent.has(pairKey(leg.fromEventId, leg.toEventId)));
  if (gone.length > 0) {
    await db.delete(legs).where(inArray(legs.id, gone.map((leg) => leg.id)));
  }

  for (const leg of stored.filter((l) => adjacent.has(pairKey(l.fromEventId, l.toEventId)))) {
    const { fromPlaceId, toPlaceId } = legEndpoints(byId.get(leg.fromEventId)!, byId.get(leg.toEventId)!);
    if (fromPlaceId === leg.fromPlaceId && toPlaceId === leg.toPlaceId) continue;
    try {
      const result = await calculate(db, deps, leg.mode, fromPlaceId, toPlaceId);
      await db.update(legs).set({ ...result, fromPlaceId, toPlaceId }).where(eq(legs.id, leg.id));
    } catch (err) {
      if (!isProviderError(err)) throw err;
      // The old places stay on the Leg, so the next sync tries again.
      await db.update(legs).set(CANNOT_CALCULATE).where(eq(legs.id, leg.id));
    }
  }
}
