import {
  insertAt,
  planDayDeletion,
  type DayDeletion,
  type HoldingArea,
  type RestoreDayInput,
  isReorderOf,
  lodgingAfterDelete,
  lodgingAfterInsert,
  lodgingFits,
  removeId,
  type Stay,
  type CreateEventInput,
  type CreateNoteInput,
  type Note,
  type RestoreNoteInput,
  type UpdateNoteInput,
  type CreateTodoInput,
  type CreateTripInput,
  type DeletedEvent,
  type Todo,
  type UpdateTodoInput,
  type Day,
  type Event,
  type Trip,
  type UpdateEventInput,
  type UpdateTripInput,
} from "@travel-planner/shared";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { days, eventImages, events, legs, notes, todos, trips, users } from "./db/schema";
import type { ImageStore, PreparedImage } from "./images";
import { randomUUID } from "node:crypto";

// A Trip the user owns or has been invited to edit. Everything but sharing needs this much (PRD §8).
export const editableBy = (userId: string) =>
  or(
    eq(trips.ownerId, userId),
    sql`exists (select 1 from trip_members tm where tm."tripId" = ${trips.id} and tm."userId" = ${userId})`,
  )!;

function toEvent(row: Pick<typeof events.$inferSelect, keyof Event>): Event {
  return {
    id: row.id,
    dayId: row.dayId,
    holding: row.holding,
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
    placeId: row.placeId,
    destinationId: row.destinationId,
    openingHoursOn: row.openingHoursOn,
    imageId: row.imageId,
  };
}

function toTodo(row: typeof todos.$inferSelect): Todo {
  return { id: row.id, eventId: row.eventId, text: row.text, done: row.done, createdBy: row.createdBy };
}

function toNote(row: typeof notes.$inferSelect): Note {
  return { id: row.id, body: row.body, pinned: row.pinned, updatedAt: row.updatedAt.toISOString() };
}

const todoOrder = [asc(todos.createdAt), asc(todos.id)];

const eventColumns = {
  id: true,
  dayId: true,
  holding: true,
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
  placeId: true,
  destinationId: true,
  openingHoursOn: true,
  imageId: true,
} as const;

const arrivalOrder = [asc(events.createdAt), asc(events.id)];

// The same columns, for a select (the query API above takes `eventColumns`).
const eventColumnsSelect = {
  id: events.id,
  dayId: events.dayId,
  holding: events.holding,
  kind: events.kind,
  title: events.title,
  startMinute: events.startMinute,
  durationMinutes: events.durationMinutes,
  transportLabel: events.transportLabel,
  nights: events.nights,
  checkInMinute: events.checkInMinute,
  checkOutMinute: events.checkOutMinute,
  description: events.description,
  phone: events.phone,
  email: events.email,
  website: events.website,
  bookingUrl: events.bookingUrl,
  placeId: events.placeId,
  destinationId: events.destinationId,
  openingHoursOn: events.openingHoursOn,
  imageId: events.imageId,
};

export async function listTrips(db: Db, userId: string): Promise<Trip[]> {
  const rows = await db.query.trips.findMany({
    // Written against the query's own table alias, so it cannot reuse `editableBy`.
    where: (t) =>
      or(
        eq(t.ownerId, userId),
        sql`exists (select 1 from trip_members tm where tm."tripId" = ${t.id} and tm."userId" = ${userId})`,
      ),
    orderBy: [desc(trips.createdAt), desc(trips.id)],
    columns: { id: true, title: true, travelMode: true, startDate: true, ownerId: true },
    with: {
      days: {
        orderBy: asc(days.position),
        columns: { id: true, position: true },
        with: {
          events: {
            orderBy: [asc(events.startMinute), ...arrivalOrder],
            columns: eventColumns,
          },
        },
      },
      events: {
        where: isNotNull(events.holding),
        orderBy: arrivalOrder,
        columns: eventColumns,
      },
      todos: {
        orderBy: todoOrder,
        columns: { id: true, eventId: true, text: true, done: true, createdBy: true },
      },
      notes: {
        orderBy: [desc(notes.updatedAt), asc(notes.id)],
        columns: { id: true, body: true, pinned: true, updatedAt: true },
      },
      legs: {
        orderBy: asc(legs.id),
        columns: { id: true, dayId: true, fromEventId: true, toEventId: true, mode: true, durationMinutes: true, distanceMeters: true },
      },
    },
  });
  return rows.map(({ events: held, notes: noteRows, ownerId, ...trip }) => ({
    ...trip,
    role: ownerId === userId ? ("owner" as const) : ("editor" as const),
    notes: noteRows.map((n) => ({ ...n, updatedAt: n.updatedAt.toISOString() })),
    backlog: held.filter((e) => e.holding === "backlog"),
    archive: held.filter((e) => e.holding === "archive"),
  }));
}

// The Trip as someone with its share link sees it: Days, Backlog and Legs, without Todos, Notes or
// the Archive (PRD §8). "off" when the Owner turned the link off; undefined when no Trip has it.
export async function getSharedTrip(db: Db, token: string): Promise<Trip | "off" | undefined> {
  const row = await db.query.trips.findFirst({
    where: eq(trips.shareToken, token),
    columns: { id: true, title: true, travelMode: true, startDate: true, shareEnabled: true },
    with: {
      days: {
        orderBy: asc(days.position),
        columns: { id: true, position: true },
        with: { events: { orderBy: [asc(events.startMinute), ...arrivalOrder], columns: eventColumns } },
      },
      events: { where: eq(events.holding, "backlog"), orderBy: arrivalOrder, columns: eventColumns },
      legs: {
        orderBy: asc(legs.id),
        columns: { id: true, dayId: true, fromEventId: true, toEventId: true, mode: true, durationMinutes: true, distanceMeters: true },
      },
    },
  });
  if (!row) return undefined;
  if (!row.shareEnabled) return "off";
  return {
    id: row.id,
    title: row.title,
    travelMode: row.travelMode,
    startDate: row.startDate,
    role: "viewer",
    days: row.days,
    legs: row.legs,
    backlog: row.events,
    archive: [],
    todos: [],
    notes: [],
  };
}

// The Trip behind a share link that is on (for the Viewer's live connection and place lookups).
export async function sharedTripId(db: Db, token: string): Promise<string | undefined> {
  const [row] = await db.select({ id: trips.id }).from(trips).where(and(eq(trips.shareToken, token), eq(trips.shareEnabled, true)));
  return row?.id;
}

// Which of these places the shared Trip's visible Events (and the destinations of its Transport events) use,
// so the link is not a way to read the paid provider through our cache.
export async function sharedPlaceIds(db: Db, token: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ placeId: events.placeId, destinationId: events.destinationId })
    .from(events)
    .innerJoin(trips, eq(events.tripId, trips.id))
    .where(
      and(
        eq(trips.shareToken, token),
        eq(trips.shareEnabled, true),
        // What a Viewer sees: Events on a Day or in the Backlog, never the Archive.
        or(isNotNull(events.dayId), eq(events.holding, "backlog")),
        or(inArray(events.placeId, ids), inArray(events.destinationId, ids)),
      ),
    );
  const used = new Set(rows.flatMap((r) => [r.placeId, r.destinationId]));
  return ids.filter((id) => used.has(id));
}

export async function createTrip(db: Db, userId: string, input: CreateTripInput): Promise<Trip> {
  return db.transaction(async (tx) => {
    const [trip] = await tx
      .insert(trips)
      .values({ ownerId: userId, title: input.title, travelMode: input.travelMode, startDate: input.startDate })
      .returning();
    const [day] = await tx.insert(days).values({ tripId: trip!.id, position: 1 }).returning();
    return {
      id: trip!.id,
      title: trip!.title,
      days: [{ id: day!.id, position: day!.position, events: [] }],
      backlog: [],
      archive: [],
      todos: [],
      notes: [],
      legs: [],
      travelMode: trip!.travelMode,
      startDate: trip!.startDate,
      role: "owner",
    };
  });
}

// Changes the Trip's settings; undefined when it is not owned by this user.
export async function updateTrip(db: Db, userId: string, tripId: string, input: UpdateTripInput): Promise<{ startDate: string | null } | undefined> {
  const [row] = await db
    .update(trips)
    .set({ startDate: input.startDate })
    .where(and(eq(trips.id, tripId), editableBy(userId)))
    .returning({ startDate: trips.startDate });
  return row;
}

// Returns undefined when the Day is not in a Trip owned by this user.
// Takes a shared lock on the Trip row, so it cannot interleave with a Day change (which holds the
// exclusive lock); otherwise an Event added while its Day is being deleted would be cascaded away.
export async function addEvent(
  db: Db,
  userId: string,
  tripId: string,
  dayId: string,
  input: CreateEventInput,
): Promise<Event | undefined | "invalid-lodging"> {
  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), editableBy(userId)))
      .for("share");
    if (!trip) return undefined;

    // A separate statement: it must see the Days as they are after the lock was granted.
    const [day] = await tx
      .select({ id: days.id })
      .from(days)
      .where(and(eq(days.id, dayId), eq(days.tripId, tripId)));
    if (!day) return undefined;
    if (input.kind === "lodging" && !(await stayFits(tx, tripId, dayId, input.nights))) return "invalid-lodging";

    const [event] = await tx.insert(events).values({ tripId, dayId, ...input }).returning();
    return toEvent(event!);
  });
}

// Adds an Event to the Backlog or the Archive. Returns undefined when the user does not own the
// Trip. A Lodging still needs its nights, but they need not fit the Trip's Days yet.
export async function addHeldEvent(
  db: Db,
  userId: string,
  tripId: string,
  holding: HoldingArea,
  input: CreateEventInput,
): Promise<Event | undefined | "invalid-lodging"> {
  if (input.kind === "lodging" && !input.nights) return "invalid-lodging";
  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), editableBy(userId)))
      .for("share");
    if (!trip) return undefined;
    const [event] = await tx.insert(events).values({ tripId, holding, ...input }).returning();
    return toEvent(event!);
  });
}

// Changes the given fields of an Event; `dayId` moves it onto a Day of the same Trip and `area`
// into the Backlog or the Archive (its start time is kept). Returns undefined when the Event is
// not in a Trip owned by this user, and "invalid-day" when the target Day is not in the Trip.
// Takes the same shared Trip lock as addEvent.
export async function updateEvent(
  db: Db,
  userId: string,
  tripId: string,
  eventId: string,
  input: UpdateEventInput,
): Promise<Event | undefined | "invalid-day" | "invalid-lodging"> {
  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), editableBy(userId)))
      .for("share");
    if (!trip) return undefined;

    const [current] = await tx
      .select({ id: events.id, kind: events.kind, nights: events.nights, dayId: events.dayId, holding: events.holding, placeId: events.placeId })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tripId, tripId)))
      // So two updates of one Event run one after another, each checking the latest values.
      .for("update");
    if (!current) return undefined;

    if (input.dayId) {
      const [target] = await tx
        .select({ id: days.id })
        .from(days)
        .where(and(eq(days.id, input.dayId), eq(days.tripId, tripId)));
      if (!target) return "invalid-day";
    }

    // Where the Event ends up: a Day (its id), or a holding area (undefined).
    const finalDayId = input.area ? undefined : (input.dayId ?? current.dayId ?? undefined);
    const kind = input.kind ?? current.kind;
    const nights = input.nights !== undefined ? input.nights : current.nights;
    if (kind === "lodging" && !nights) return "invalid-lodging";
    if (kind === "lodging" && finalDayId && !(await stayFits(tx, tripId, finalDayId, nights))) {
      return "invalid-lodging";
    }

    const { area, ...fields } = input;
    // An Event's Todos are deleted when it is archived, and not brought back (PRD §5).
    if (area === "archive" && current.holding !== "archive") {
      await tx.delete(todos).where(eq(todos.eventId, eventId));
    }
    const place = area ? { dayId: null, holding: area } : input.dayId ? { holding: null } : {};
    // Opening hours belong to the place they were asked for: another place or none turns them off.
    const hours = input.placeId !== undefined && input.placeId !== current.placeId ? { openingHoursOn: false } : {};
    const [event] = await tx
      .update(events)
      .set({ ...fields, ...place, ...hours })
      .where(eq(events.id, eventId))
      .returning();
    return toEvent(event!);
  });
}

// The kind and place of an Event of this user's Trip, for the opening hours request.
export async function findEventPlace(db: Db, userId: string, tripId: string, eventId: string) {
  const [row] = await db
    .select({ kind: events.kind, placeId: events.placeId })
    .from(events)
    .innerJoin(trips, eq(trips.id, events.tripId))
    .where(and(eq(events.id, eventId), eq(events.tripId, tripId), editableBy(userId)));
  return row;
}

// Turns the Event's opening hours on or off (PRD §3.5). On only while its place is still the one
// the hours were fetched for: `placeId` is checked in the same statement, so a place changed in
// between leaves it off. Returns the Event, or undefined when it is not in this user's Trip.
export async function setOpeningHours(
  db: Db,
  userId: string,
  tripId: string,
  eventId: string,
  on: boolean,
  placeId?: string,
): Promise<Event | undefined> {
  const found = await findEventPlace(db, userId, tripId, eventId);
  if (!found) return undefined;
  const [row] = await db
    .update(events)
    .set({ openingHoursOn: on })
    .where(and(eq(events.id, eventId), eq(events.tripId, tripId), placeId ? eq(events.placeId, placeId) : undefined))
    .returning();
  if (row) return toEvent(row);
  const [current] = await db.select().from(events).where(eq(events.id, eventId));
  // Deleted while the hours were being fetched.
  return current && toEvent(current);
}

// Gives the Event this image, replacing the one it had (step 39). The file is stored first and the
// row switched in one transaction, so a failure leaves the old image in place; the old file is deleted
// last. Returns the Event, or undefined when it is not in this user's Trip.
export async function setEventImage(
  db: Db,
  store: ImageStore,
  userId: string,
  tripId: string,
  eventId: string,
  image: PreparedImage,
): Promise<Event | undefined> {
  if (!(await findEventPlace(db, userId, tripId, eventId))) return undefined;
  const imageId = randomUUID();
  await store.put(imageId, image.bytes);
  let old: string | undefined;
  let event: Event | undefined;
  try {
    event = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.id, eventId), eq(events.tripId, tripId)))
        .for("update");
      if (!locked) return undefined;
      const [previous] = await tx.delete(eventImages).where(eq(eventImages.eventId, eventId)).returning({ key: eventImages.storageKey });
      old = previous?.key;
      await tx.insert(eventImages).values({ id: imageId, eventId, storageKey: imageId, contentType: image.contentType, byteSize: image.bytes.length, createdBy: userId });
      const [row] = await tx.update(events).set({ imageId }).where(eq(events.id, eventId)).returning();
      return toEvent(row!);
    });
  } catch (err) {
    await store.delete(imageId);
    throw err;
  }
  if (!event) {
    // Deleted while the file was being stored.
    await store.delete(imageId);
    return undefined;
  }
  if (old) await store.delete(old);
  return event;
}

// Takes the image off the Event. Returns the Event, or undefined when it is not in this user's Trip;
// an Event without an image is returned as it is.
export async function removeEventImage(db: Db, store: ImageStore, userId: string, tripId: string, eventId: string): Promise<Event | undefined> {
  if (!(await findEventPlace(db, userId, tripId, eventId))) return undefined;
  const removed = await db.delete(eventImages).where(eq(eventImages.eventId, eventId)).returning({ key: eventImages.storageKey });
  const [row] = await db.select(eventColumnsSelect).from(events).where(and(eq(events.id, eventId), eq(events.tripId, tripId)));
  for (const { key } of removed) await store.delete(key);
  return row && toEvent(row);
}

export type StoredImage = { key: string; contentType: string; imageId: string };

// The Event's image for someone who can edit the Trip, or undefined.
export async function findEventImage(db: Db, userId: string, tripId: string, eventId: string): Promise<StoredImage | undefined> {
  const [row] = await db
    .select({ key: eventImages.storageKey, contentType: eventImages.contentType, imageId: eventImages.id })
    .from(eventImages)
    .innerJoin(events, eq(events.id, eventImages.eventId))
    .innerJoin(trips, eq(trips.id, events.tripId))
    .where(and(eq(events.id, eventId), eq(events.tripId, tripId), editableBy(userId)));
  return row;
}

// The same for a Viewer: only Events that Viewer sees (on a Day or in the Backlog, never the
// Archive) of a Trip whose link is on.
export async function findSharedEventImage(db: Db, token: string, eventId: string): Promise<StoredImage | undefined> {
  const [row] = await db
    .select({ key: eventImages.storageKey, contentType: eventImages.contentType, imageId: eventImages.id })
    .from(eventImages)
    .innerJoin(events, eq(events.id, eventImages.eventId))
    .innerJoin(trips, eq(trips.id, events.tripId))
    .where(
      and(
        eq(events.id, eventId),
        eq(trips.shareToken, token),
        eq(trips.shareEnabled, true),
        or(isNotNull(events.dayId), eq(events.holding, "backlog")),
      ),
    );
  return row;
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
async function lockTripDays(tx: Tx, userId: string, tripId: string): Promise<string[] | undefined> {
  const [trip] = await tx
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), editableBy(userId)))
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
  userId: string,
  tripId: string,
  position: number,
): Promise<Day[] | undefined | "invalid-position"> {
  return db.transaction(async (tx) => {
    const ids = await lockTripDays(tx, userId, tripId);
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
  userId: string,
  tripId: string,
  dayIds: string[],
): Promise<Day[] | undefined | "invalid-order"> {
  return db.transaction(async (tx) => {
    const ids = await lockTripDays(tx, userId, tripId);
    if (!ids) return undefined;
    if (!isReorderOf(ids, dayIds)) return "invalid-order";

    // A stay is tied to positions, so it stays where it is and points at the Day now there.
    const stays = await loadStays(tx, tripId);
    await applyDayOrder(tx, tripId, dayIds);
    await placeStays(tx, dayIds, stays);
    return loadDays(tx, tripId);
  });
}

async function loadBacklog(tx: Tx, tripId: string): Promise<Event[]> {
  const rows = await tx
    .select(eventColumnsSelect)
    .from(events)
    .where(and(eq(events.tripId, tripId), eq(events.holding, "backlog")))
    .orderBy(...arrivalOrder);
  return rows.map(toEvent);
}

// Deletes a Day (a Trip keeps at least one). Its Events go to the Backlog, with their details and
// start time; a Lodging only loses a night, unless that was its only one (PRD §3.1, §3.2). Later
// Days are renumbered. Returns the Trip's Days and Backlog after the change.
export async function deleteDay(
  db: Db,
  userId: string,
  tripId: string,
  dayId: string,
): Promise<DayDeletion | undefined | "last-day"> {
  return db.transaction(async (tx) => {
    const ids = await lockTripDays(tx, userId, tripId);
    if (!ids?.includes(dayId)) return undefined;
    if (ids.length === 1) return "last-day";

    const plan = planDayDeletion(await loadDays(tx, tripId), dayId);
    const movedIds = new Set(plan.moved.map((e) => e.id));
    if (movedIds.size > 0) {
      // Before the Day is deleted, so none of them is cascaded away with it.
      await tx.update(events).set({ dayId: null, holding: "backlog" }).where(inArray(events.id, [...movedIds]));
    }

    const position = ids.indexOf(dayId) + 1;
    const adjusted: PlacedStay[] = [];
    for (const { id, stay } of await loadStays(tx, tripId)) {
      const result = lodgingAfterDelete(stay, position);
      if (result !== "empty") adjusted.push({ id, stay: result });
    }

    const order = removeId(ids, dayId);
    // Also before the deletion, for the same reason.
    await placeStays(tx, order, adjusted);
    await tx.delete(days).where(eq(days.id, dayId));
    await applyDayOrder(tx, tripId, order);
    return { days: await loadDays(tx, tripId), backlog: await loadBacklog(tx, tripId) };
  });
}

// Undoes deleteDay: the Day comes back with its old id at its old position, and each placement
// puts an Event back on the Day (and, for a Lodging, its nights) as it was. Placements are
// trusted to be what the client saw before the deletion, so they only need to name this Trip's
// Events and Days. Returns undefined when the user does not own the Trip.
class RestoreRefused extends Error {}

export async function restoreDay(
  db: Db,
  userId: string,
  tripId: string,
  input: RestoreDayInput,
): Promise<DayDeletion | undefined | "invalid" | "exists"> {
  try {
    return await restoreInTransaction(db, userId, tripId, input);
  } catch (err) {
    if (err instanceof RestoreRefused) return "invalid";
    throw err;
  }
}

async function restoreInTransaction(
  db: Db,
  userId: string,
  tripId: string,
  input: RestoreDayInput,
): Promise<DayDeletion | undefined | "invalid" | "exists"> {
  return db.transaction(async (tx) => {
    const ids = await lockTripDays(tx, userId, tripId);
    if (!ids) return undefined;
    if (input.position > ids.length + 1) return "invalid";
    const [taken] = await tx.select({ id: days.id }).from(days).where(eq(days.id, input.dayId));
    if (taken) return "exists";

    const order = insertAt(ids, input.dayId, input.position);
    const placed = input.placements.map((p) => p.eventId);
    const own = placed.length
      ? await tx
          .select({ id: events.id, holding: events.holding, tripId: events.tripId })
          .from(events)
          .where(inArray(events.id, placed))
      : [];
    const dayKnown = (id: string) => order.includes(id);
    // An Event of another Trip is refused; one deleted since (PRD §5 allows it) is simply skipped.
    if (new Set(placed).size !== placed.length || own.some((e) => e.tripId !== tripId) || !input.placements.every((p) => dayKnown(p.dayId))) {
      return "invalid";
    }

    // An Event archived since the deletion stays archived.
    const archived = new Set(own.filter((e) => e.holding === "archive").map((e) => e.id));
    const present = new Set(own.map((e) => e.id));
    const placements = input.placements.filter((p) => present.has(p.eventId) && !archived.has(p.eventId));

    await tx.insert(days).values({ id: input.dayId, tripId, position: ids.length + 1 });
    await applyDayOrder(tx, tripId, order);
    for (const p of placements) {
      await tx
        .update(events)
        .set({ dayId: p.dayId, holding: null, ...(p.nights === null ? {} : { nights: p.nights }) })
        .where(eq(events.id, p.eventId));
    }
    // Days may have changed since the deletion, so every stay must still fit.
    for (const { id, stay } of await loadStays(tx, tripId)) {
      if (placements.some((p) => p.eventId === id) && !lodgingFits(stay, order.length)) {
        throw new RestoreRefused();
      }
    }
    return { days: await loadDays(tx, tripId), backlog: await loadBacklog(tx, tripId) };
  });
}

// Every Todo function returns undefined when the Trip is not owned by this user (or the Todo or
// Event is not in it).

// Adds a Trip Todo, or an Event Todo when `eventId` is set. An archived Event has no Todos
// (they are deleted on archiving), so it is refused with "archived".
export async function addTodo(
  db: Db,
  userId: string,
  tripId: string,
  input: CreateTodoInput,
): Promise<Todo | undefined | "archived"> {
  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), editableBy(userId)))
      .for("share");
    if (!trip) return undefined;
    if (input.eventId) {
      const [event] = await tx
        .select({ holding: events.holding })
        .from(events)
        .where(and(eq(events.id, input.eventId), eq(events.tripId, tripId)))
        // Waits for an archiving that is in progress, then sees the Event as archived.
        .for("share");
      if (!event) return undefined;
      if (event.holding === "archive") return "archived";
    }
    const [row] = await tx
      .insert(todos)
      .values({ tripId, eventId: input.eventId, text: input.text, createdBy: userId })
      .returning();
    return toTodo(row!);
  });
}

export async function canEditTrip(db: Db, userId: string, tripId: string) {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), editableBy(userId)));
  return !!trip;
}

export async function updateTodo(
  db: Db,
  userId: string,
  tripId: string,
  todoId: string,
  input: UpdateTodoInput,
): Promise<Todo | undefined> {
  if (!(await canEditTrip(db, userId, tripId))) return undefined;
  const [row] = await db
    .update(todos)
    .set(input)
    .where(and(eq(todos.id, todoId), eq(todos.tripId, tripId)))
    .returning();
  return row && toTodo(row);
}

export async function deleteTodo(db: Db, userId: string, tripId: string, todoId: string): Promise<true | undefined> {
  if (!(await canEditTrip(db, userId, tripId))) return undefined;
  const rows = await db
    .delete(todos)
    .where(and(eq(todos.id, todoId), eq(todos.tripId, tripId)))
    .returning({ id: todos.id });
  return rows.length > 0 ? true : undefined;
}

// Deletes an Event with its Todos and returns both as they were, so the deletion can be undone.
// `gone.imageKey` is set to the key of the Event's image, which went with it: the caller deletes the
// file. It is read under the same lock as an image replacement takes, so the two never interleave.
export async function deleteEvent(
  db: Db,
  userId: string,
  tripId: string,
  eventId: string,
  gone: { imageKey?: string } = {},
): Promise<DeletedEvent | undefined> {
  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), editableBy(userId)))
      .for("share");
    if (!trip) return undefined;
    const [event] = await tx
      .select(eventColumnsSelect)
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tripId, tripId)))
      .for("update");
    if (!event) return undefined;
    const removedTodos = await tx.select().from(todos).where(eq(todos.eventId, eventId)).orderBy(...todoOrder);
    const [image] = await tx.select({ key: eventImages.storageKey }).from(eventImages).where(eq(eventImages.eventId, eventId));
    gone.imageKey = image?.key;
    // The Todos and the image row are deleted with the Event (cascade).
    await tx.delete(events).where(eq(events.id, eventId));
    return { event: toEvent(event), todos: removedTodos.map(toTodo) };
  });
}

// Undoes deleteEvent: the Event comes back with its old id, and its Todos with it. It returns to
// its Day, or to the Backlog when the Day is gone or a stay's nights no longer fit, so undo never
// fails for that reason. Placed Events are trusted to be what deleteEvent returned.
export async function restoreEvent(
  db: Db,
  userId: string,
  tripId: string,
  input: DeletedEvent,
): Promise<Event | undefined | "invalid" | "exists"> {
  const { event, todos: restored } = input;
  const consistent =
    restored.every((t) => t.eventId === event.id) &&
    new Set(restored.map((t) => t.id)).size === restored.length &&
    // An archived Event has no Todos.
    (event.holding !== "archive" || restored.length === 0);
  if (!consistent) return (await canEditTrip(db, userId, tripId)) ? "invalid" : undefined;

  try {
    return await restoreEventInTransaction(db, userId, tripId, input);
  } catch (err) {
    // Two restores of the same snapshot at once: the second hits the primary key.
    const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return "exists";
    throw err;
  }
}

async function restoreEventInTransaction(
  db: Db,
  userId: string,
  tripId: string,
  input: DeletedEvent,
): Promise<Event | undefined | "invalid" | "exists"> {
  const { event, todos: restored } = input;
  return db.transaction(async (tx) => {
    // The shared lock keeps the Day from being deleted while the Event is put back on it.
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), editableBy(userId)))
      .for("share");
    if (!trip) return undefined;

    const [taken] = await tx.select({ id: events.id }).from(events).where(eq(events.id, event.id));
    if (taken) return "exists";
    if (restored.length > 0) {
      const ids = restored.map((t) => t.id);
      const clash = await tx.select({ id: todos.id }).from(todos).where(inArray(todos.id, ids));
      const creators = await tx
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, [...new Set(restored.map((t) => t.createdBy))]));
      if (clash.length > 0 || creators.length !== new Set(restored.map((t) => t.createdBy)).size) return "invalid";
    }

    let dayId = event.dayId;
    if (dayId) {
      const [day] = await tx
        .select({ id: days.id })
        .from(days)
        .where(and(eq(days.id, dayId), eq(days.tripId, tripId)));
      if (!day || (event.kind === "lodging" && !(await stayFits(tx, tripId, dayId, event.nights)))) dayId = null;
    }
    const place = dayId ? { dayId, holding: null } : { dayId: null, holding: event.holding ?? ("backlog" as const) };
    const [row] = await tx
      .insert(events)
      // The image went with the Event; undo brings back the Event, not the file.
      .values({ ...event, imageId: null, tripId, ...place })
      .returning();
    if (restored.length > 0) {
      // One timestamp apart, so they come back in the order they had.
      const base = Date.now();
      await tx.insert(todos).values(restored.map((t, i) => ({ ...t, tripId, createdAt: new Date(base + i) })));
    }
    return toEvent(row!);
  });
}

// Notes: each function returns undefined when the Trip is not owned by this user (or the Note is
// not in it).

export async function addNote(db: Db, userId: string, tripId: string, input: CreateNoteInput): Promise<Note | undefined> {
  if (!(await canEditTrip(db, userId, tripId))) return undefined;
  const [row] = await db.insert(notes).values({ tripId, body: input.body }).returning();
  return toNote(row!);
}

// Editing the text moves the Note to the top of the list; pinning does not.
export async function updateNote(
  db: Db,
  userId: string,
  tripId: string,
  noteId: string,
  input: UpdateNoteInput,
): Promise<Note | undefined> {
  if (!(await canEditTrip(db, userId, tripId))) return undefined;
  const [row] = await db
    .update(notes)
    .set({ ...input, ...(input.body !== undefined ? { updatedAt: sql`now()` } : {}) })
    .where(and(eq(notes.id, noteId), eq(notes.tripId, tripId)))
    .returning();
  return row && toNote(row);
}

export async function deleteNote(db: Db, userId: string, tripId: string, noteId: string): Promise<true | undefined> {
  if (!(await canEditTrip(db, userId, tripId))) return undefined;
  const rows = await db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.tripId, tripId)))
    .returning({ id: notes.id });
  return rows.length > 0 ? true : undefined;
}

// Undoes deleteNote: the Note comes back with its old id, pin and edit time. Returns "exists" when
// a Note with that id is there already.
export async function restoreNote(
  db: Db,
  userId: string,
  tripId: string,
  input: RestoreNoteInput,
): Promise<Note | undefined | "exists"> {
  if (!(await canEditTrip(db, userId, tripId))) return undefined;
  const { note } = input;
  const [row] = await db
    .insert(notes)
    .values({ id: note.id, tripId, body: note.body, pinned: note.pinned, updatedAt: new Date(note.updatedAt) })
    .onConflictDoNothing()
    .returning();
  return row ? toNote(row) : "exists";
}

// Which of these places the user's own Events use. Opening hours are only handed out for those, so
// the hours endpoint is not a way to read the paid provider through our cache.
export async function ownPlaceIds(db: Db, userId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .selectDistinct({ placeId: events.placeId })
    .from(events)
    .innerJoin(trips, eq(events.tripId, trips.id))
    .where(and(editableBy(userId), inArray(events.placeId, ids)));
  return rows.map((r) => r.placeId!);
}
