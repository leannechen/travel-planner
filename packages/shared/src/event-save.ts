import { parseTime } from "./time-layout";
import { durationBetween } from "./transport";
import { detailSchemas, DEFAULT_DURATION_MINUTES, DEFAULT_START_MINUTE, isHoldingArea, MAX_DURATION_MINUTES, MAX_NIGHTS, TRANSPORT_LABELS } from "./index";
import type { CreateEventInput, Event, UpdateEventInput } from "./index";

// What the edit panel holds as text. `arrival` is used for Transport events, where the duration
// is derived from it; `duration` is used for the other kinds. `transportLabel` is "" for none.
export type EventFields = {
  title: string;
  // A Day id, or "backlog" or "archive" for an Event outside any Day.
  dayId: string;
  kind: Event["kind"];
  start: string;
  duration: string;
  arrival: string;
  transportLabel: string;
  // Lodging: the number of nights, and optional check-in and check-out times ("" for none).
  nights: string;
  checkIn: string;
  checkOut: string;
  description: string;
  phone: string;
  email: string;
  website: string;
  bookingUrl: string;
  // Provider place ids; "" for none. A Transport event's `placeId` is its departure place.
  placeId: string;
  destinationId: string;
};

type DetailKey = keyof typeof detailSchemas;

// Which kinds show which detail field (PRD §3.2). A field a kind does not show keeps its value.
export const showsContact = (kind: Event["kind"]) => kind !== "transport";

// Opening hours are for the kinds a visit has hours for (PRD §3.2).
export const showsOpeningHours = (kind: Event["kind"]) => kind === "attraction" || kind === "meal";
export const showsBookingLink = (kind: Event["kind"]) => kind !== "attraction";
const showsDetail = (kind: Event["kind"], key: DetailKey) =>
  key === "phone" || key === "email" || key === "website"
    ? showsContact(kind)
    : key === "bookingUrl"
      ? showsBookingLink(kind)
      : true;

const DETAIL_ERRORS: Record<DetailKey, string> = {
  description: "The Description is too long",
  phone: "The phone number is too long",
  email: "Enter a valid email address",
  website: "Enter a website starting with http:// or https://",
  bookingUrl: "Enter a booking link starting with http:// or https://",
};

export type SavePlan =
  | { kind: "wait" } // a new Event without a title yet
  | { kind: "nothing" } // nothing differs from what is saved
  | { kind: "error"; message: string }
  | { kind: "create"; dayId: string /* or a holding area */; input: CreateEventInput }
  | { kind: "update"; patch: UpdateEventInput };

// Decides what saving the edit panel's fields means: validate them, then either create a new
// Event, send only what changed, or do nothing.
export function planEventSave(fields: EventFields, saved: Event | undefined): SavePlan {
  const title = fields.title.trim();
  if (!title) return saved ? { kind: "error", message: "Title is required" } : { kind: "wait" };

  // Outside a Day an Event has no start time: the last one is kept, and a Transport event is
  // measured by its duration (there is no departure to arrive from).
  const held = isHoldingArea(fields.dayId);
  const lodging = fields.kind === "lodging" ? lodgingFields(fields) : undefined;
  if (lodging && "error" in lodging) return { kind: "error", message: lodging.error };

  // A Lodging has no start time or duration of its own: they are hidden, so keep what is saved.
  const startMinute = lodging
    ? (saved?.startMinute ?? parseTime(fields.start) ?? DEFAULT_START_MINUTE)
    : held
      ? (parseTime(fields.start) ?? saved?.startMinute ?? DEFAULT_START_MINUTE)
      : parseTime(fields.start);
  const durationMinutes = lodging
    ? (saved?.durationMinutes ?? typedDuration(fields.duration) ?? DEFAULT_DURATION_MINUTES)
    : fields.kind === "transport" && !held
      ? transportDuration(startMinute, fields.arrival)
      : typedDuration(fields.duration);
  if (startMinute === undefined || durationMinutes === undefined) {
    return {
      kind: "error",
      message:
        fields.kind === "transport" && !held
          ? "Enter a departure time and a different arrival time"
          : held
            ? `Enter a duration of 1 to ${MAX_DURATION_MINUTES} whole minutes`
            : `Enter a start time and a duration of 1 to ${MAX_DURATION_MINUTES} whole minutes`,
    };
  }
  const transportLabel = TRANSPORT_LABELS.find((label) => label === fields.transportLabel) ?? null;
  // Lodging fields are only sent while the Event is a Lodging; otherwise they stay as they are.
  const stay = lodging ?? { nights: null, checkInMinute: null, checkOutMinute: null };

  // The details this kind shows, normalized (trimmed, blank as null); the others stay as they are.
  const details: Partial<Record<DetailKey, string | null>> = {};
  for (const key of Object.keys(detailSchemas) as DetailKey[]) {
    if (!showsDetail(fields.kind, key)) continue;
    const parsed = detailSchemas[key].safeParse(fields[key]);
    if (!parsed.success) return { kind: "error", message: DETAIL_ERRORS[key] };
    details[key] = parsed.data;
  }

  if (!saved) {
    return {
      kind: "create",
      dayId: fields.dayId,
      input: {
        title,
        kind: fields.kind,
        startMinute,
        durationMinutes,
        transportLabel,
        ...stay,
        description: null,
        phone: null,
        email: null,
        website: null,
        bookingUrl: null,
        placeId: fields.placeId || null,
        destinationId: fields.destinationId || null,
        ...details,
      },
    };
  }

  const patch: UpdateEventInput = {};
  if (title !== saved.title) patch.title = title;
  if (fields.dayId !== (saved.dayId ?? saved.holding)) {
    if (isHoldingArea(fields.dayId)) patch.area = fields.dayId;
    else patch.dayId = fields.dayId;
  }
  if (fields.kind !== saved.kind) patch.kind = fields.kind;
  if (transportLabel !== saved.transportLabel) patch.transportLabel = transportLabel;
  if (startMinute !== saved.startMinute) patch.startMinute = startMinute;
  if (durationMinutes !== saved.durationMinutes) patch.durationMinutes = durationMinutes;
  if (lodging) {
    if (lodging.nights !== saved.nights) patch.nights = lodging.nights;
    if (lodging.checkInMinute !== saved.checkInMinute) patch.checkInMinute = lodging.checkInMinute;
    if (lodging.checkOutMinute !== saved.checkOutMinute) patch.checkOutMinute = lodging.checkOutMinute;
  }
  if ((fields.placeId || null) !== saved.placeId) patch.placeId = fields.placeId || null;
  if ((fields.destinationId || null) !== saved.destinationId) patch.destinationId = fields.destinationId || null;
  for (const [key, value] of Object.entries(details) as [DetailKey, string | null][]) {
    if (value !== saved[key]) patch[key] = value;
  }
  return Object.keys(patch).length === 0 ? { kind: "nothing" } : { kind: "update", patch };
}

// The Lodging fields as numbers; an empty check-in or check-out time means none.
function lodgingFields(
  fields: EventFields,
): { error: string } | { nights: number; checkInMinute: number | null; checkOutMinute: number | null } {
  const nights = Number(fields.nights);
  if (fields.nights.trim() === "" || !Number.isInteger(nights) || nights < 1 || nights > MAX_NIGHTS) {
    return { error: `Enter a number of nights from 1 to ${MAX_NIGHTS}` };
  }
  const optionalTime = (text: string) => (text.trim() === "" ? null : (parseTime(text) ?? undefined));
  const checkInMinute = optionalTime(fields.checkIn);
  const checkOutMinute = optionalTime(fields.checkOut);
  if (checkInMinute === undefined || checkOutMinute === undefined) {
    return { error: "Enter the check-in and check-out times as hours and minutes, or leave them empty" };
  }
  return { nights, checkInMinute, checkOutMinute };
}

// The minutes typed in the Duration field, or undefined while they are not a valid duration.
export function typedDuration(text: string): number | undefined {
  const minutes = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_DURATION_MINUTES;
  return valid ? minutes : undefined;
}

function transportDuration(startMinute: number | undefined, arrival: string): number | undefined {
  const arrivalMinute = parseTime(arrival);
  if (startMinute === undefined || arrivalMinute === undefined) return undefined;
  return durationBetween(startMinute, arrivalMinute);
}
