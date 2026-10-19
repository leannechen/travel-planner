import { z } from "zod";
import { legSchema, travelModeSchema } from "./legs";
import { startDateSchema } from "./trip-dates";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

const title = z.string().trim().min(1, "Title is required").max(200);

// Minutes from 00:00 of the Day. An Event may run past midnight; the axis cuts it off there.
// One minute short of a day, so a Transport event never arrives at its own departure time.
export const MAX_DURATION_MINUTES = 1439;
const startMinute = z.number().int().min(0).max(1439);
const durationMinutes = z.number().int().min(1).max(MAX_DURATION_MINUTES);

export const MAX_NIGHTS = 365;

// A place is stored on an Event by its provider id only (Google allows storing place ids, not the
// rest of its place data; ADR 0007). The name, address and coordinates are looked up by id.
export const placeIdSchema = z.string().trim().min(1).max(300);
export const placeSchema = z.object({
  id: placeIdSchema,
  name: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
});
export type Place = z.infer<typeof placeSchema>;
export const MAX_PLACE_QUERY_LENGTH = 200;
export const MAX_PLACE_IDS = 20;

export const DEFAULT_START_MINUTE = 9 * 60;
export const DEFAULT_DURATION_MINUTES = 60;

export const EVENT_KINDS = ["attraction", "meal", "lodging", "transport"] as const;
export const TRANSPORT_LABELS = ["flight", "train", "ferry", "bus", "other"] as const;
export const kindSchema = z.enum(EVENT_KINDS);
export const transportLabelSchema = z.enum(TRANSPORT_LABELS);

// Description, contacts and the booking link. Values are trimmed and a blank one means none.
export const MAX_DESCRIPTION_LENGTH = 10000;
const blankToNull = (value: string) => (value === "" ? null : value);
const optionalText = (max: number) => z.string().trim().max(max).transform(blankToNull).nullable();
export const isWebUrl = (value: string) => /^https?:\/\//i.test(value) && URL.canParse(value);
const optionalWebUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => value === "" || isWebUrl(value), "Enter a link starting with http:// or https://")
  .transform(blankToNull)
  .nullable();
const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === "" || z.email().safeParse(value).success, "Enter a valid email address")
  .transform(blankToNull)
  .nullable();
export const detailSchemas = {
  description: optionalText(MAX_DESCRIPTION_LENGTH),
  phone: optionalText(50),
  email: optionalEmail,
  website: optionalWebUrl,
  bookingUrl: optionalWebUrl,
};

const nightsField = z.number().int().min(1).max(MAX_NIGHTS).nullable();

// Where an Event is outside any Day (PRD §4).
export const HOLDING_AREAS = ["backlog", "archive"] as const;
export const holdingAreaSchema = z.enum(HOLDING_AREAS);
export type HoldingArea = z.infer<typeof holdingAreaSchema>;
export const isHoldingArea = (place: string): place is HoldingArea => (HOLDING_AREAS as readonly string[]).includes(place);

// An Event is either on a Day (`dayId`) or in a holding area (`holding`), never both. In a holding
// area its start time is not shown; the last one is kept so scheduling it again starts from there.
export const eventSchema = z.object({
  id: z.uuid(),
  dayId: z.uuid().nullable(),
  holding: holdingAreaSchema.nullable(),
  kind: kindSchema,
  title,
  startMinute,
  durationMinutes,
  // Only meaningful for Transport, but kept when the kind changes so switching back restores it.
  transportLabel: transportLabelSchema.nullable(),
  // Lodging only, also kept when the kind changes. Check-in and check-out times are display only.
  nights: nightsField,
  checkInMinute: startMinute.nullable(),
  checkOutMinute: startMinute.nullable(),
  ...detailSchemas,
  // The Event's place (a Transport event's departure place) and, for Transport only, its
  // destination. Both are optional and kept when the kind changes.
  placeId: placeIdSchema.nullable(),
  destinationId: placeIdSchema.nullable(),
  // Whether the user asked for the place's opening hours (PRD §3.5). Only this choice is kept on
  // the Event; the hours are read through the place cache. Turned off when the place changes.
  openingHoursOn: z.boolean(),
});

const todoText = z.string().trim().min(1, "Todo text is required").max(500);

// A to-do item of a Trip (`eventId` null) or of one Event.
export const todoSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid().nullable(),
  text: todoText,
  done: z.boolean(),
  createdBy: z.uuid(),
});
export type Todo = z.infer<typeof todoSchema>;

export const MAX_NOTE_LENGTH = 20000;

// A standalone Markdown entry of a Trip's notes list (PRD §5.1). `updatedAt` is when its text was
// last edited; pinning does not change it.
export const noteSchema = z.object({
  id: z.uuid(),
  body: z.string().max(MAX_NOTE_LENGTH),
  pinned: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type Note = z.infer<typeof noteSchema>;

export const daySchema = z.object({
  id: z.uuid(),
  position: z.number().int().positive(),
  events: z.array(eventSchema),
});

export const tripSchema = z.object({
  id: z.uuid(),
  title,
  days: z.array(daySchema),
  backlog: z.array(eventSchema),
  archive: z.array(eventSchema),
  // Trip Todos and Event Todos together.
  todos: z.array(todoSchema),
  notes: z.array(noteSchema),
  // Legs between adjacent Events of the Days, and the mode a new Leg starts with.
  legs: z.array(legSchema),
  travelMode: travelModeSchema,
  // The first Day's calendar date, or null: Days are then just Day 1, Day 2... (PRD §3.1).
  startDate: startDateSchema.nullable(),
});

export const createTripInputSchema = z.object({ title, travelMode: travelModeSchema.optional(), startDate: startDateSchema.nullable().optional() });
// Trip settings: so far only the start date (null clears it).
export const updateTripInputSchema = z.object({ startDate: startDateSchema.nullable() });
export type UpdateTripInput = z.infer<typeof updateTripInputSchema>;
export const createEventInputSchema = z.object({
  title,
  kind: kindSchema.default("attraction"),
  transportLabel: transportLabelSchema.nullable().default(null),
  nights: nightsField.default(null),
  checkInMinute: startMinute.nullable().default(null),
  checkOutMinute: startMinute.nullable().default(null),
  description: detailSchemas.description.default(null),
  phone: detailSchemas.phone.default(null),
  email: detailSchemas.email.default(null),
  website: detailSchemas.website.default(null),
  bookingUrl: detailSchemas.bookingUrl.default(null),
  placeId: placeIdSchema.nullable().default(null),
  destinationId: placeIdSchema.nullable().default(null),
  startMinute: startMinute.default(DEFAULT_START_MINUTE),
  durationMinutes: durationMinutes.default(DEFAULT_DURATION_MINUTES),
});

export type Event = z.infer<typeof eventSchema>;
export type Day = z.infer<typeof daySchema>;
export type Trip = z.infer<typeof tripSchema>;
export type CreateTripInput = z.infer<typeof createTripInputSchema>;
export type CreateEventInput = z.infer<typeof createEventInputSchema>;

export const createDayInputSchema = z.object({ position: z.number().int().positive() });
export const reorderDaysInputSchema = z.object({ dayIds: z.array(z.uuid()) });

export const updateEventInputSchema = z
  .object({
    title: title.optional(),
    kind: kindSchema.optional(),
    transportLabel: transportLabelSchema.nullable().optional(),
    nights: nightsField.optional(),
    checkInMinute: startMinute.nullable().optional(),
    checkOutMinute: startMinute.nullable().optional(),
    description: detailSchemas.description.optional(),
    phone: detailSchemas.phone.optional(),
    email: detailSchemas.email.optional(),
    website: detailSchemas.website.optional(),
    bookingUrl: detailSchemas.bookingUrl.optional(),
    placeId: placeIdSchema.nullable().optional(),
    destinationId: placeIdSchema.nullable().optional(),
    // Moves the Event onto a Day, or into a holding area; not both.
    dayId: z.uuid().optional(),
    area: holdingAreaSchema.optional(),
    startMinute: startMinute.optional(),
    durationMinutes: durationMinutes.optional(),
  })
  .refine((input) => Object.values(input).some((v) => v !== undefined), {
    message: "Provide at least one field to change",
  })
  .refine((input) => input.dayId === undefined || input.area === undefined, {
    message: "Give a Day or a holding area, not both",
  });

export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;

// Putting a deleted Day back (undo): the Day with its old position, and the Events that were moved
// or adjusted when it was deleted, as they were.
export const restoreDayInputSchema = z.object({
  dayId: z.uuid(),
  position: z.number().int().positive(),
  placements: z.array(z.object({ eventId: z.uuid(), dayId: z.uuid(), nights: nightsField })),
});
export type RestoreDayInput = z.infer<typeof restoreDayInputSchema>;

// What deleting a Day returns: the Trip's Days and Backlog after the change.
export const dayDeletionSchema = z.object({ days: z.array(daySchema), backlog: z.array(eventSchema) });
export type DayDeletion = z.infer<typeof dayDeletionSchema>;

export type CreateDayInput = z.infer<typeof createDayInputSchema>;
export type ReorderDaysInput = z.infer<typeof reorderDaysInputSchema>;

export * from "./day-deletion";
export * from "./day-order";
export * from "./event-list";
export * from "./event-save";
export * from "./keyboard";
export * from "./legs";
export * from "./lodging-range";
export * from "./notes";
export * from "./opening-hours";
export * from "./time-edit";
export * from "./time-layout";
export * from "./todo-removal";
export * from "./trip-dates";
export * from "./transport";

export const createTodoInputSchema = z.object({ text: todoText, eventId: z.uuid().nullable().default(null) });
export const updateTodoInputSchema = z
  .object({ text: todoText.optional(), done: z.boolean().optional() })
  .refine((input) => input.text !== undefined || input.done !== undefined, {
    message: "Provide at least one field to change",
  });
export type CreateTodoInput = z.infer<typeof createTodoInputSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoInputSchema>;

// A deleted Event with its Todos as they were; also what restoring it (undo) sends back.
export const deletedEventSchema = z.object({ event: eventSchema, todos: z.array(todoSchema) });
export type DeletedEvent = z.infer<typeof deletedEventSchema>;

export const meSchema = z.object({ id: z.uuid() });
export type Me = z.infer<typeof meSchema>;

// A Note always has some text: a new one is not saved until something is typed, and a Note
// that is emptied is deleted (PRD §5.1).
const noteBody = z.string().max(MAX_NOTE_LENGTH).refine((v) => v.trim() !== "", "A Note needs some text");
export const createNoteInputSchema = z.object({ body: noteBody });
export const updateNoteInputSchema = z
  .object({ body: noteBody.optional(), pinned: z.boolean().optional() })
  .refine((input) => input.body !== undefined || input.pinned !== undefined, {
    message: "Provide at least one field to change",
  });
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;

// Putting a deleted Note back (undo): the Note as it was, with its id and edit time, so its place
// in the list is kept.
export const restoreNoteInputSchema = z.object({ note: noteSchema.extend({ body: noteBody }) });
export type RestoreNoteInput = z.infer<typeof restoreNoteInputSchema>;
