import { z } from "zod";
import { legSchema, travelModeSchema } from "./legs";
import { lodgingFits } from "./lodging-range";
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
  // A short form of the address for the Event block, like "Fushimi Ward, Kyoto"; empty when the
  // provider has none. Never stored on an Event (PRD §3.2).
  area: z.string(),
  lat: z.number(),
  lng: z.number(),
  // Local time at the place, minutes ahead of UTC; used to turn a Day's clock time into a departure time.
  utcOffsetMinutes: z.number().int().optional(),
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
  // The id of the Event's uploaded image, or null. The file is read at `.../image`; a new image gets a
  // new id, so a changed id is what tells a page its copy is old.
  imageId: z.uuid().nullable(),
  // True once the user took the image off: the place's Google photo is then not shown either, until
  // "Use place photo" clears it (step 41). An upload does not change it; a new place keeps it.
  placePhotoHidden: z.boolean(),
});

// A place's Google photo as the server hands it out (step 41): a short-lived address to show the
// picture from, the authors to credit, and the place's page on Google Maps. Never stored.
const photoAuthorSchema = z.object({ name: z.string(), uri: z.string().nullable() });
export const placePhotoSchema = z.object({
  photoUri: z.string(),
  authors: z.array(photoAuthorSchema),
  mapsUri: z.string().nullable(),
});
// What the server keeps of a place's photo: the provider's reference and the authors, never the picture.
export const placePhotoRefSchema = z.object({ name: z.string(), authors: z.array(photoAuthorSchema) });
export type PlacePhotoRef = z.infer<typeof placePhotoRefSchema>;
export type PlacePhoto = z.infer<typeof placePhotoSchema>;

// What an uploaded Event image may be (step 39): JPEG, PNG or WebP, at most this many bytes as sent.
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Uploads (plan step 45): how often a picture may be sent, and how many a user may keep. Replacing a
// picture does not add to the count; deleting one, or its Event, gives it back.
export const UPLOAD_LIMITS = { perMinute: { user: 10, ip: 30 }, perDay: { account: 200, guest: 40, ip: 400 } } as const;
export const MAX_STORED_IMAGES = { account: 300, guest: 30 } as const;
// How many Trips a user owns at most (a guest has fewer). Per Trip, the limits are the MAX_SEED_* below.
export const MAX_TRIPS = { account: 200, guest: 20 } as const;
export const isImageType = (type: string): type is (typeof IMAGE_TYPES)[number] => (IMAGE_TYPES as readonly string[]).includes(type);

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
  // What the user may do with it: the Owner also shares and deletes; an Editor edits (PRD §8).
  // "viewer": the Trip opened through its share link (read-only; no Todos, Notes or Archive).
  role: z.enum(["owner", "editor", "viewer"]),
});

export const createTripInputSchema = z.object({ title, travelMode: travelModeSchema.optional(), startDate: startDateSchema.nullable().optional() });
// Trip settings: the start date (null clears it), the title and the default travel mode. At least one is given.
export const updateTripInputSchema = z
  .object({ startDate: startDateSchema.nullable().optional(), title: title.optional(), travelMode: travelModeSchema.optional() })
  .refine((input) => input.startDate !== undefined || input.title !== undefined || input.travelMode !== undefined, { message: "Nothing to change" });
export type UpdateTripInput = z.infer<typeof updateTripInputSchema>;
// The answer to opening the sample Trip (PRD §1): the user's copy, and whether this request made it.
export const sampleTripResponseSchema = z.object({ tripId: z.uuid(), created: z.boolean() });
export type SampleTripResponse = z.infer<typeof sampleTripResponseSchema>;
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
  placePhotoHidden: z.boolean().default(false),
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
    placePhotoHidden: z.boolean().optional(),
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
export * from "./map-plan";
export * from "./itinerary";
export * from "./backup";

export const createTodoInputSchema = z.object({ text: todoText, eventId: z.uuid().nullable().default(null) });
export const updateTodoInputSchema = z
  .object({ text: todoText.optional(), done: z.boolean().optional() })
  .refine((input) => input.text !== undefined || input.done !== undefined, {
    message: "Provide at least one field to change",
  });
export type CreateTodoInput = z.infer<typeof createTodoInputSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoInputSchema>;

// A new Trip's content without ids (ADR 0008): the sample Trip, an AI-generated Trip and an imported
// backup are each made as a seed and written to the database the same way. Days are in their order,
// places are provider ids.
const seedTodoSchema = z.object({ text: todoText, done: z.boolean().default(false) });
// An Event's uploaded image carried in a seed (a backup): the file as base64. The importer checks
// that it really is a picture before it keeps it.
export const seedImageSchema = z.object({ contentType: z.enum(IMAGE_TYPES), data: z.string().max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4) });
const seedNoteSchema = z.object({
  body: z.string().max(MAX_NOTE_LENGTH).refine((v) => v.trim() !== "", "A Note needs some text"),
  pinned: z.boolean().default(false),
});
export const seedEventSchema = createEventInputSchema.extend({
  openingHoursOn: z.boolean().default(false),
  todos: z.array(seedTodoSchema).default([]),
  // The mode of a Leg from this Event to the next one of its Day, or null for no Leg. A Leg is made
  // only when the two are adjacent on the timeline (Lodging is a banner, so it is skipped) and both
  // have a place.
  legToNext: travelModeSchema.nullable().default(null),
  image: seedImageSchema.nullable().default(null),
});
// Bounds on what one seed may hold, so an imported file cannot make an unusable Trip.
export const MAX_SEED_DAYS = 100;
export const MAX_SEED_EVENTS = 1000;
export const MAX_SEED_TODOS = 1000;
export const MAX_SEED_NOTES = 1000;
// All images of one seed together, as base64 characters (the size of a backup file).
export const MAX_SEED_IMAGE_CHARS = 60_000_000;
export const tripSeedSchema = z
  .object({
    title,
    travelMode: travelModeSchema.default("transit"),
    startDate: startDateSchema.nullable().default(null),
    days: z.array(z.array(seedEventSchema)).min(1).max(MAX_SEED_DAYS),
    backlog: z.array(seedEventSchema).default([]),
    archive: z.array(seedEventSchema).default([]),
    // Trip Todos; an Event's Todos are on the Event.
    todos: z.array(seedTodoSchema).default([]),
    // In the order the Notes panel shows them: pinned first, then by most recent edit. A Note's
    // edit time is not kept; the order is.
    notes: z.array(seedNoteSchema).max(MAX_SEED_NOTES).default([]),
  })
  .superRefine((seed, ctx) => {
    const all = [...seed.days.flat(), ...seed.backlog, ...seed.archive];
    if (all.reduce((n, e) => n + (e.image?.data.length ?? 0), 0) > MAX_SEED_IMAGE_CHARS) ctx.addIssue({ code: "custom", message: "The images are too large together" });
    if (all.length > MAX_SEED_EVENTS) ctx.addIssue({ code: "custom", message: `At most ${MAX_SEED_EVENTS} Events` });
    if (seed.todos.length + all.reduce((n, e) => n + e.todos.length, 0) > MAX_SEED_TODOS) {
      ctx.addIssue({ code: "custom", message: `At most ${MAX_SEED_TODOS} Todos` });
    }
    // The same rules as for an Event saved on its own: a Lodging has nights, and a scheduled one
    // ends within the Trip (PRD §3.2); an archived Event has no Todos (PRD §5).
    if (all.some((e) => e.kind === "lodging" && e.nights === null)) ctx.addIssue({ code: "custom", message: "A Lodging needs nights" });
    seed.days.forEach((list, i) => {
      for (const e of list) {
        if (e.kind === "lodging" && e.nights !== null && !lodgingFits({ checkInPosition: i + 1, nights: e.nights }, seed.days.length)) {
          ctx.addIssue({ code: "custom", message: `"${e.title}" stays past the last Day`, path: ["days", i] });
        }
      }
    });
    if (seed.archive.some((e) => e.todos.length > 0)) ctx.addIssue({ code: "custom", message: "An archived Event has no Todos", path: ["archive"] });
  });
// What a seed is written from (defaults may be left out) and what it is after parsing.
export type TripSeedInput = z.input<typeof tripSeedSchema>;
export type TripSeed = z.infer<typeof tripSeedSchema>;
export type SeedEventInput = z.input<typeof seedEventSchema>;
export type SeedEvent = z.infer<typeof seedEventSchema>;
export type SeedImage = z.infer<typeof seedImageSchema>;

// A full backup of a Trip (PRD §9): a JSON file that holds a Trip seed with its Notes and the images
// the user uploaded. Importing it writes a new Trip through the same writer as the sample Trip and AI
// generation. `buildBackup` makes one from a Trip.
// The largest backup file the API reads: the images plus room for text.
export const MAX_BACKUP_BYTES = MAX_SEED_IMAGE_CHARS + 64 * 1024 * 1024;
export const BACKUP_FORMAT = "travel-planner-backup";
export const BACKUP_VERSION = 1;
export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  trip: tripSeedSchema,
});
export type Backup = z.infer<typeof backupSchema>;
// Backup imports an account may start a day (UTC), counted before the file is read.
export const IMPORT_DAILY_ATTEMPTS = 20;

// Paid Google calls (plan step 33). Every call that reaches Google counts, an answer from the cache
// does not. A call counts for the user (an account or a guest session) and for the IP address, and
// is refused when either has used its share: the IP's share stops a guest who keeps making new
// sessions. Searches (typed in the Location field) and lookups (place details, opening hours,
// photos, travel times) have separate shares; searches also have one per minute.
export const SEARCH_LIMITS = { perMinute: { user: 30, ip: 60 }, perDay: { account: 300, guest: 100, ip: 500 } } as const;
export const LOOKUP_LIMITS = { perDay: { account: 1000, guest: 200, ip: 1500 } } as const;

// Anything that sends email (plan step 44), so the app cannot be used to mail arbitrary addresses.
// Every invitation counts, also one asked for again or withdrawn later, for the Owner, for the Trip
// and for the IP address; the verification email can be asked for again a few times a day.
export const INVITE_LIMITS = { perDay: { user: 20, trip: 20, ip: 50 } } as const;
export const RESEND_LIMITS = { perDay: { user: 5, ip: 20 } } as const;

// AI generation (PRD §7, ADR 0008). A logged-in user may start this many a day (UTC); a generation
// that failed does not count unless the model answered, but all attempts together are capped too.
export const AI_DAILY_LIMIT = 3;
export const AI_DAILY_ATTEMPTS = 10;
export const MAX_AI_DAYS = 14;
export const MAX_AI_EVENTS_PER_DAY = 6;
// Place searches per generation; Events past it get no place (place lookups cost the most).
export const MAX_AI_PLACE_LOOKUPS = 60;
export const MAX_AI_PROMPT_LENGTH = 1000;
// The interface languages; the Trip is written in the one the user has.
export const AI_LANGUAGES = ["en", "zh"] as const;
export const generateTripInputSchema = z.object({
  prompt: z.string().trim().min(1, "Describe the trip").max(MAX_AI_PROMPT_LENGTH),
  language: z.enum(AI_LANGUAGES),
});
export type GenerateTripInput = z.infer<typeof generateTripInputSchema>;

// What the model answers. It is loose on purpose (`normalizeItinerary` makes it fit the app's rules)
// and every field is present, possibly null, as strict structured output requires.
export const aiEventSchema = z.object({
  title: z.string(),
  kind: kindSchema,
  // "HH:MM", 24-hour clock.
  start: z.string(),
  durationMinutes: z.number(),
  // A specific named place to look up ("Uffizi Gallery, Florence"), or null for a general one ("Lunch").
  // For Transport, where it leaves from; `destinationQuery` is where it arrives.
  placeQuery: z.string().nullable(),
  destinationQuery: z.string().nullable(),
  transportLabel: transportLabelSchema.nullable(),
  // Lodging only: the nights from this Day on.
  nights: z.number().nullable(),
  description: z.string().nullable(),
});
export const aiItinerarySchema = z.object({
  title: z.string(),
  // "YYYY-MM-DD" when the prompt gives dates, else null.
  startDate: z.string().nullable(),
  // How the prompt says the traveller gets around ("by car", "on foot"), else null.
  travelMode: travelModeSchema.nullable(),
  days: z.array(z.object({ events: z.array(aiEventSchema) })),
});
export type AiEvent = z.infer<typeof aiEventSchema>;
export type AiItinerary = z.infer<typeof aiItinerarySchema>;

// A generation as the web app follows it. A failed one says why: "unusable" when the model could not
// make a Trip of the prompt (or refused), "failed" when something went wrong and trying again may work.
export const generationSchema = z.object({
  id: z.uuid(),
  status: z.enum(["running", "done", "failed"]),
  tripId: z.uuid().nullable(),
  failure: z.enum(["unusable", "failed"]).nullable(),
});
export type Generation = z.infer<typeof generationSchema>;
// How many generations the user has left today, and the one still running, if any.
export const generationsSummarySchema = z.object({ remaining: z.number().int().min(0), running: generationSchema.nullable() });
export type GenerationsSummary = z.infer<typeof generationsSummarySchema>;

// A deleted Event with its Todos as they were; also what restoring it (undo) sends back.
export const deletedEventSchema = z.object({ event: eventSchema, todos: z.array(todoSchema) });
export type DeletedEvent = z.infer<typeof deletedEventSchema>;

// Sharing a Trip with Editors (PRD §8). The Owner sees who can edit and which invitations wait.
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const inviteEditorInputSchema = z.object({ email: emailSchema });
export type InviteEditorInput = z.infer<typeof inviteEditorInputSchema>;
export const invitationSchema = z.object({ id: z.uuid(), email: z.string(), token: z.string() });
export const editorSchema = z.object({ userId: z.uuid(), email: z.string().nullable() });
export const shareLinkSchema = z.object({ enabled: z.boolean(), token: z.string().nullable() });
export const sharingSchema = z.object({ editors: z.array(editorSchema), invitations: z.array(invitationSchema), link: shareLinkSchema });
export const setShareLinkInputSchema = z.object({ enabled: z.boolean() });
export type ShareLink = z.infer<typeof shareLinkSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type Sharing = z.infer<typeof sharingSchema>;
// An address with the middle of its name hidden ("l*****w@gmail.com"), for pages that anyone holding
// a link can open.
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const name = email.slice(0, at);
  const hidden = name.length <= 2 ? "*".repeat(name.length) : `${name[0]}${"*".repeat(Math.min(name.length - 2, 6))}${name.at(-1)}`;
  return `${hidden}${email.slice(at)}`;
}

// What the invitation page shows to whoever holds the link, before login. The invited address is
// masked: the page only needs to tell the person which address to use.
export const invitationPreviewSchema = z.object({ tripTitle: z.string(), invitedEmail: z.string(), inviterEmail: z.string().nullable() });
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
export const acceptedInvitationSchema = z.object({ tripId: z.uuid(), tripTitle: z.string() });
export type AcceptedInvitation = z.infer<typeof acceptedInvitationSchema>;

// Who the request acts as: an account, or an anonymous guest session (PRD §8).
export const meSchema = z.object({ id: z.uuid(), guest: z.boolean() });
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

// Live collaboration (ADR 0003): the browser opens one WebSocket per open Trip and says who it is
// in its first message; the server then tells it when someone else changed the Trip and who is here.
// Room for the longest access token the hello accepts, plus the rest of the message.
export const MAX_LIVE_MESSAGE_BYTES = 16 * 1024;
export const liveHelloSchema = z.object({
  type: z.literal("hello"),
  tripId: z.uuid(),
  // This page's own id: changes it made are not announced back to it.
  clientId: z.string().min(1).max(64),
  // The access token of an account, or else the anonymous session's id.
  token: z.string().min(1).max(8192).optional(),
  guest: z.uuid().optional(),
  // Or the secret of the Trip's share link: a Viewer, who needs no login and only hears about changes.
  share: z.string().min(1).max(200).optional(),
});
export type LiveHello = z.infer<typeof liveHelloSchema>;
// Only the first letter of the name goes to the others (null for a guest): collaborators do not see each other's email.
export const livePersonSchema = z.object({ id: z.string(), initial: z.string().nullable() });
export type LivePerson = z.infer<typeof livePersonSchema>;
export const liveMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  // The Trip changed; `origin` is the clientId of the page that did it.
  z.object({ type: z.literal("changed"), origin: z.string().nullable() }),
  z.object({ type: z.literal("presence"), people: z.array(livePersonSchema) }),
]);
export type LiveMessage = z.infer<typeof liveMessageSchema>;
export const CLIENT_ID_HEADER = "x-client-id";
