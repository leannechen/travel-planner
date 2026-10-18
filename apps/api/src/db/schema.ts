import { relations, sql } from "drizzle-orm";
import { check, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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
export const transportLabel = pgEnum("transport_label", ["flight", "train", "ferry", "bus", "other"]);

// startMinute and durationMinutes: minutes from 00:00 of the Day, and length. The defaults
// (09:00, 60 minutes) are what Events created before the time model were given.
export const events = pgTable(
  "events",
  {
    id: uuid().primaryKey().defaultRandom(),
    dayId: uuid()
      .notNull()
      .references(() => days.id, { onDelete: "cascade" }),
    kind: eventKind().notNull().default("attraction"),
    title: text().notNull(),
    // Kept when the kind changes, so switching back to Transport restores it.
    transportLabel: transportLabel(),
    // Lodging only, kept when the kind changes. Check-in and check-out times are display only.
    nights: integer(),
    checkInMinute: integer(),
    checkOutMinute: integer(),
    startMinute: integer().notNull().default(540),
    durationMinutes: integer().notNull().default(60),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("events_start_minute_range", sql`${t.startMinute} between 0 and 1439`),
    check("events_lodging_has_nights", sql`${t.kind} <> 'lodging' or ${t.nights} is not null`),
    check("events_nights_range", sql`${t.nights} is null or ${t.nights} between 1 and 365`),
    check("events_check_in_range", sql`${t.checkInMinute} is null or ${t.checkInMinute} between 0 and 1439`),
    check("events_check_out_range", sql`${t.checkOutMinute} is null or ${t.checkOutMinute} between 0 and 1439`),
    check("events_duration_range", sql`${t.durationMinutes} between 1 and 1439`),
  ],
);

export const tripsRelations = relations(trips, ({ many }) => ({ days: many(days) }));
export const daysRelations = relations(days, ({ one, many }) => ({
  trip: one(trips, { fields: [days.tripId], references: [trips.id] }),
  events: many(events),
}));
export const eventsRelations = relations(events, ({ one }) => ({
  day: one(days, { fields: [events.dayId], references: [days.id] }),
}));
