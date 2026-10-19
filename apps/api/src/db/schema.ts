import { relations, sql } from "drizzle-orm";
import { boolean, check, doublePrecision, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const trips = pgTable("trips", {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: uuid()
    .notNull()
    .references(() => users.id),
  title: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const days = pgTable(
  "days",
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    position: integer().notNull(),
  },
  (t) => [unique("days_trip_position_unique").on(t.tripId, t.position)],
);

export const eventKind = pgEnum("event_kind", ["attraction", "meal", "lodging", "transport"]);
export const holdingArea = pgEnum("holding_area", ["backlog", "archive"]);
export const transportLabel = pgEnum("transport_label", ["flight", "train", "ferry", "bus", "other"]);

// startMinute and durationMinutes: minutes from 00:00 of the Day, and length. The defaults
// (09:00, 60 minutes) are what Events created before the time model were given.
export const events = pgTable(
  "events",
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    // An Event is on a Day or in a holding area, never both. Its start time is kept in a holding
    // area (not shown), so scheduling it again starts from there.
    dayId: uuid().references(() => days.id, { onDelete: "cascade" }),
    holding: holdingArea(),
    kind: eventKind().notNull().default("attraction"),
    title: text().notNull(),
    // Kept when the kind changes, so switching back to Transport restores it.
    transportLabel: transportLabel(),
    // Lodging only, kept when the kind changes. Check-in and check-out times are display only.
    nights: integer(),
    checkInMinute: integer(),
    checkOutMinute: integer(),
    // Shown for the kinds that have them, kept when the kind changes.
    description: text(),
    phone: text(),
    email: text(),
    website: text(),
    bookingUrl: text(),
    // Provider place ids (ADR 0007): the place, and for Transport the destination. The place data
    // itself lives in `places`, a cache.
    placeId: text(),
    destinationId: text(),
    startMinute: integer().notNull().default(540),
    durationMinutes: integer().notNull().default(60),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("events_one_place", sql`(${t.dayId} is not null) <> (${t.holding} is not null)`),
    check("events_start_minute_range", sql`${t.startMinute} between 0 and 1439`),
    check("events_lodging_has_nights", sql`${t.kind} <> 'lodging' or ${t.nights} is not null`),
    check("events_nights_range", sql`${t.nights} is null or ${t.nights} between 1 and 365`),
    check("events_check_in_range", sql`${t.checkInMinute} is null or ${t.checkInMinute} between 0 and 1439`),
    check("events_check_out_range", sql`${t.checkOutMinute} is null or ${t.checkOutMinute} between 0 and 1439`),
    check("events_duration_range", sql`${t.durationMinutes} between 1 and 1439`),
  ],
);

// Place data fetched from the place provider, kept as a cache: the provider's terms allow storing
// place ids but not the rest beyond a limited time, so rows are refreshed when older than that
// (ADR 0007). Events refer to a place by id only.
export const places = pgTable("places", {
  id: text().primaryKey(),
  name: text().notNull(),
  address: text().notNull(),
  lat: doublePrecision().notNull(),
  lng: doublePrecision().notNull(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A Todo of a Trip (`eventId` null) or of one Event. An Event's Todos go with it when it is deleted
// (cascade) and are deleted by the code when it is archived (PRD §5).
export const todos = pgTable("todos", {
  id: uuid().primaryKey().defaultRandom(),
  tripId: uuid()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  eventId: uuid().references(() => events.id, { onDelete: "cascade" }),
  text: text().notNull(),
  done: boolean().notNull().default(false),
  createdBy: uuid()
    .notNull()
    .references(() => users.id),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A standalone Markdown entry of a Trip's notes list. `updatedAt` changes when the text is edited,
// not when the Note is pinned.
export const notes = pgTable("notes", {
  id: uuid().primaryKey().defaultRandom(),
  tripId: uuid()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  body: text().notNull(),
  pinned: boolean().notNull().default(false),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const tripsRelations = relations(trips, ({ many }) => ({
  days: many(days),
  events: many(events),
  todos: many(todos),
  notes: many(notes),
}));
export const daysRelations = relations(days, ({ one, many }) => ({
  trip: one(trips, { fields: [days.tripId], references: [trips.id] }),
  events: many(events),
}));
export const eventsRelations = relations(events, ({ one }) => ({
  day: one(days, { fields: [events.dayId], references: [days.id] }),
  trip: one(trips, { fields: [events.tripId], references: [trips.id] }),
}));
export const todosRelations = relations(todos, ({ one }) => ({
  trip: one(trips, { fields: [todos.tripId], references: [trips.id] }),
  event: one(events, { fields: [todos.eventId], references: [events.id] }),
}));
export const notesRelations = relations(notes, ({ one }) => ({
  trip: one(trips, { fields: [notes.tripId], references: [trips.id] }),
}));
