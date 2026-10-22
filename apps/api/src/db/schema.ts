import { relations, sql } from "drizzle-orm";
import { boolean, check, date, doublePrecision, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { OpeningHours, PlacePhotoRef } from "@travel-planner/shared";

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  // Who the user is: the Auth0 subject of an account (ADR 0006), or the secret of an anonymous
  // guest session kept in the browser. Exactly one is set; a guest's Trips move to the account on
  // login and the guest row goes.
  auth0Sub: text().unique(),
  guestToken: uuid().unique(),
  // An account's email address as the last access token said it (lower case), shown in the Share
  // dialog; null for a guest and for a token that carries none.
  email: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const travelMode = pgEnum("travel_mode", ["drive", "transit", "walk"]);

export const trips = pgTable(
  "trips",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id),
    title: text().notNull(),
    // The mode a new Leg of the Trip starts with.
    travelMode: travelMode().notNull().default("transit"),
    // The first Day's calendar date ("YYYY-MM-DD"), or null.
    startDate: date({ mode: "string" }),
    // The secret in the Trip's read-only link (PRD §8). Made when the link is first turned on and kept
    // when it is turned off, so the old link can say it is off.
    shareToken: text().unique(),
    shareEnabled: boolean().notNull().default(false),
    // Which sample Trip this is a copy of (PRD §1), or null for an ordinary Trip. A user has at most
    // one copy of each sample, so opening the sample again opens that copy.
    sampleOf: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("trips_owner_sample_unique").on(t.ownerId, t.sampleOf)],
);

// An Editor of a Trip other than its Owner (PRD §8). The Owner is `trips.ownerId`, not a row here.
export const tripMembers = pgTable(
  "trip_members",
  {
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.userId] })],
);

// An invitation to edit a Trip, sent to one email address. The secret `token` is in the link; the
// invitation is accepted only by a verified account with that address, and once (`acceptedBy`).
export const tripInvitations = pgTable(
  "trip_invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    // Lower case.
    email: text().notNull(),
    token: text().notNull().unique(),
    invitedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acceptedBy: uuid().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("trip_invitations_trip_email_unique").on(t.tripId, t.email)],
);

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
    // The user asked for the place's opening hours (PRD §3.5). Only the choice is kept here; the
    // hours are read through the `places` cache. Cleared when the place changes.
    openingHoursOn: boolean().notNull().default(false),
    // The image was taken off, so the place's Google photo is not shown either (step 41).
    placePhotoHidden: boolean().notNull().default(false),
    // The Event's uploaded image (step 39); the row holds where the file is kept. Cleared with the row.
    imageId: uuid().references((): AnyPgColumn => eventImages.id, { onDelete: "set null" }),
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

// The image an Event was given (one per Event). The bytes live in the image store under `storageKey`
// (never in the database); the row goes with its Event, and the file is deleted by the code that
// deletes or replaces the row.
export const eventImages = pgTable("event_images", {
  id: uuid().primaryKey().defaultRandom(),
  eventId: uuid()
    .notNull()
    .unique()
    .references((): AnyPgColumn => events.id, { onDelete: "cascade" }),
  storageKey: text().notNull(),
  contentType: text().notNull(),
  byteSize: integer().notNull(),
  createdBy: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Place data fetched from the place provider, kept as a cache: the provider's terms allow storing
// place ids but not the rest beyond a limited time, so rows are refreshed when older than that
// (ADR 0007). Events refer to a place by id only.
export const places = pgTable("places", {
  id: text().primaryKey(),
  name: text().notNull(),
  address: text().notNull(),
  // The short area ("Fushimi Ward, Kyoto"); an empty string means the provider has none, null that
  // the row was cached before the field existed, so it is fetched again.
  area: text(),
  lat: doublePrecision().notNull(),
  lng: doublePrecision().notNull(),
  utcOffsetMinutes: integer(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  // Usual opening hours, fetched on request and cached like the rest of the place. `hoursFetchedAt`
  // set with null hours means the provider has none, which is not asked again before it is old.
  openingHours: jsonb().$type<OpeningHours>(),
  hoursFetchedAt: timestamp({ withTimezone: true }),
  // The provider's reference to the place's first photo and the authors to credit, cached like the
  // hours (step 41). Only the reference: the picture itself is never stored. `photoFetchedAt` set with
  // a null `photo` means the place has none, which is not asked again before it is old.
  photo: jsonb().$type<PlacePhotoRef>(),
  photoFetchedAt: timestamp({ withTimezone: true }),
});

// Travel time and distance between two places by one mode, fetched from the route provider and
// kept as a cache per pair of places, so repeated Legs do not call it again. Refreshed when old.
export const routeEstimates = pgTable(
  "route_estimates",
  {
    fromPlaceId: text().notNull(),
    toPlaceId: text().notNull(),
    mode: travelMode().notNull(),
    // The local hour of departure (0 to 23) for transit, whose time depends on the time of day; -1 for the other modes.
    departureHour: integer().notNull().default(-1),
    // Null when the provider found no route, so that is not asked again either.
    durationMinutes: integer(),
    distanceMeters: integer(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fromPlaceId, t.toPlaceId, t.mode, t.departureHour] })],
);

// A Leg: the movement between two adjacent Events of a Day (PRD §3.3). It goes when either Event
// does, and the code removes it when the Events stop being adjacent. `fromPlaceId` and `toPlaceId`
// are the places the stored duration was calculated for, so a changed location is noticed.
export const legs = pgTable(
  "legs",
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    dayId: uuid()
      .notNull()
      .references(() => days.id, { onDelete: "cascade" }),
    fromEventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    toEventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    mode: travelMode().notNull(),
    // Null while the Leg cannot be calculated.
    durationMinutes: integer(),
    distanceMeters: integer(),
    fromPlaceId: text(),
    toPlaceId: text(),
  },
  (t) => [
    unique("legs_events_unique").on(t.fromEventId, t.toEventId),
    check("legs_duration_range", sql`${t.durationMinutes} is null or ${t.durationMinutes} > 0`),
  ],
);

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
  legs: many(legs),
}));
export const legsRelations = relations(legs, ({ one }) => ({
  trip: one(trips, { fields: [legs.tripId], references: [trips.id] }),
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
