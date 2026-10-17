import { relations } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const days = pgTable("days", {
  id: uuid().primaryKey().defaultRandom(),
  tripId: uuid()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  position: integer().notNull(),
});

export const events = pgTable("events", {
  id: uuid().primaryKey().defaultRandom(),
  dayId: uuid()
    .notNull()
    .references(() => days.id, { onDelete: "cascade" }),
  title: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const tripsRelations = relations(trips, ({ many }) => ({ days: many(days) }));
export const daysRelations = relations(days, ({ one, many }) => ({
  trip: one(trips, { fields: [days.tripId], references: [trips.id] }),
  events: many(events),
}));
export const eventsRelations = relations(events, ({ one }) => ({
  day: one(days, { fields: [events.dayId], references: [days.id] }),
}));
