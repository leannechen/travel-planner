import {
  acceptedInvitationSchema,
  CLIENT_ID_HEADER,
  daySchema,
  invitationPreviewSchema,
  invitationSchema,
  sharingSchema,
  shareLinkSchema,
  dayDeletionSchema,
  deletedEventSchema,
  eventSchema,
  legSchema,
  meSchema,
  noteSchema,
  openingHoursSchema,
  placeSchema,
  sampleTripResponseSchema,
  todoSchema,
  startDateSchema,
  tripSchema,
  type CreateEventInput,
  type CreateLegInput,
  type CreateTripInput,
  type AcceptedInvitation,
  type DeletedEvent,
  type InvitationPreview,
  type HoldingArea,
  type RestoreDayInput,
  type Note,
  type TravelMode,
  type UpdateEventInput,
  type UpdateNoteInput,
  type UpdateTripInput,
  type UpdateTodoInput,
} from "@travel-planner/shared";
import { z } from "zod";
import { authHooks } from "./apiAuth";
import { SessionEndedError } from "./authClient";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// This page's own id: the API passes it on with a change, so the page is not told about its own edits.
export const clientId = crypto.randomUUID();

// How many changes are on their way and how many have finished, so a Trip loaded after someone
// else's change can tell whether it may have missed one of this page's own.
const writes = { pending: 0, finished: 0 };
export const writeActivity = () => ({ ...writes });

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const writing = init.method !== undefined && init.method !== "GET";
  if (writing) writes.pending++;
  try {
    return await sendNow(path, init);
  } finally {
    if (writing) {
      writes.pending--;
      writes.finished++;
    }
  }
}

async function sendNow(path: string, init: RequestInit): Promise<Response> {
  const hooks = authHooks();
  const auth = hooks ? await hooks.headers() : {};
  const res = await fetch(path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...auth, [CLIENT_ID_HEADER]: clientId } });
  if (res.status === 401) {
    // A token the API no longer accepts is the end of the session, not a failed request.
    const detail = (await res.clone().json().catch(() => undefined)) as { code?: string } | undefined;
    if (detail?.code === "invalid_token") {
      hooks?.onSessionEnded();
      throw new SessionEndedError();
    }
  }
  return res;
}

// A failed request; `code` is the server's machine-readable reason when it gave one.
export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

async function failure(res: Response): Promise<Error> {
  const detail = (await res.json().catch(() => undefined)) as { error?: string; code?: string } | undefined;
  return new ApiError(detail?.error ?? `Request failed: ${res.status}`, detail?.code);
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  method: Method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const res = await send(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  return schema.parse(await res.json());
}

// A read that needs no login (what a Viewer opens): no credentials are sent, and none are waited for.
async function requestPublic<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw await failure(res);
  return schema.parse(await res.json());
}

// For the calls the server answers with 204 and no body.
async function requestNothing(path: string, method: Method): Promise<void> {
  const res = await send(path, { method });
  if (!res.ok) throw await failure(res);
}

const placesSchema = z.object({ places: z.array(placeSchema) });

// The Trip a Viewer is looking at (PRD §8): while it is set, place lookups go through the share link,
// which needs no login. Set by the shared Trip page.
let sharedToken: string | undefined;
export const setSharedLink = (token: string | undefined) => {
  sharedToken = token;
};

const sharedUrl = (path: string) => `/api/shared/${encodeURIComponent(sharedToken!)}${path}`;

export const searchPlaces = (query: string) =>
  request(`/api/places/search?q=${encodeURIComponent(query)}`, placesSchema).then((r) => r.places);

export const getPlaces = (ids: string[]) =>
  (sharedToken ? requestPublic(sharedUrl(`/places?ids=${encodeURIComponent(ids.join(","))}`), placesSchema) : request(`/api/places?ids=${encodeURIComponent(ids.join(","))}`, placesSchema)).then((r) => r.places);

// Opening hours by place id; a place without hours is left out.
export const getOpeningHours = (ids: string[]) => {
  const schema = z.object({ openingHours: z.record(z.string(), openingHoursSchema) });
  const query = `ids=${encodeURIComponent(ids.join(","))}`;
  return (sharedToken ? requestPublic(sharedUrl(`/opening-hours?${query}`), schema) : request(`/api/places/opening-hours?${query}`, schema)).then(
    (r) => new Map(Object.entries(r.openingHours)),
  );
};

export const listTrips = () => request("/api/trips", z.array(tripSchema));

export const createTrip = (input: CreateTripInput) => request("/api/trips", tripSchema, input);

// The user's copy of the sample Trip: made on the first call, the same one after that (PRD §1).
export const openSampleTrip = () => request("/api/sample-trip", sampleTripResponseSchema, undefined, "POST");

// Trip settings; the answer is the start date as saved.
export const updateTrip = (tripId: string, input: UpdateTripInput) =>
  request(`/api/trips/${tripId}`, z.object({ startDate: startDateSchema.nullable() }), input, "PATCH");

export const addEvent = (tripId: string, dayId: string, input: CreateEventInput) =>
  request(`/api/trips/${tripId}/days/${dayId}/events`, eventSchema, input);

const daysSchema = z.array(daySchema);

export const insertDay = (tripId: string, position: number) =>
  request(`/api/trips/${tripId}/days`, daysSchema, { position });

export const reorderDays = (tripId: string, dayIds: string[]) =>
  request(`/api/trips/${tripId}/days/order`, daysSchema, { dayIds }, "PUT");

export const addHeldEvent = (tripId: string, area: HoldingArea, input: CreateEventInput) =>
  request(`/api/trips/${tripId}/${area}/events`, eventSchema, input);

export const deleteDay = (tripId: string, dayId: string) =>
  request(`/api/trips/${tripId}/days/${dayId}`, dayDeletionSchema, undefined, "DELETE");

export const restoreDay = (tripId: string, input: RestoreDayInput) =>
  request(`/api/trips/${tripId}/days/restore`, dayDeletionSchema, input);

export const updateEvent = (tripId: string, eventId: string, input: UpdateEventInput) =>
  request(`/api/trips/${tripId}/events/${eventId}`, eventSchema, input, "PATCH");

// Turns the Event's opening hours on: the server fetches them, and `hours` is null when Google has none.
export const turnOnOpeningHours = (tripId: string, eventId: string) =>
  request(`/api/trips/${tripId}/events/${eventId}/opening-hours`, z.object({ event: eventSchema, hours: openingHoursSchema.nullable() }), undefined, "PUT");

export const turnOffOpeningHours = (tripId: string, eventId: string) =>
  request(`/api/trips/${tripId}/events/${eventId}/opening-hours`, eventSchema, undefined, "DELETE");

export const getMe = () => request("/api/me", meSchema);

export const addTodo = (tripId: string, text: string, eventId: string | null) =>
  request(`/api/trips/${tripId}/todos`, todoSchema, { text, eventId });

export const updateTodo = (tripId: string, todoId: string, input: UpdateTodoInput) =>
  request(`/api/trips/${tripId}/todos/${todoId}`, todoSchema, input, "PATCH");

// The server answers 204 with no body.
export const deleteTodo = (tripId: string, todoId: string) => requestNothing(`/api/trips/${tripId}/todos/${todoId}`, "DELETE");

// Deletes an Event with its Todos; the answer is what restoreEvent needs to undo it.
export const deleteEvent = (tripId: string, eventId: string) =>
  request(`/api/trips/${tripId}/events/${eventId}`, deletedEventSchema, undefined, "DELETE");

export const restoreEvent = (tripId: string, deleted: DeletedEvent) =>
  request(`/api/trips/${tripId}/events/restore`, eventSchema, deleted);

export const addNote = (tripId: string, body: string) => request(`/api/trips/${tripId}/notes`, noteSchema, { body });

export const updateNote = (tripId: string, noteId: string, input: UpdateNoteInput) =>
  request(`/api/trips/${tripId}/notes/${noteId}`, noteSchema, input, "PATCH");

export const deleteNote = (tripId: string, noteId: string) => requestNothing(`/api/trips/${tripId}/notes/${noteId}`, "DELETE");

export const restoreNote = (tripId: string, note: Note) => request(`/api/trips/${tripId}/notes/restore`, noteSchema, { note });

export const listLegs = (tripId: string) => request(`/api/trips/${tripId}/legs`, z.array(legSchema));

export const createLeg = (tripId: string, input: CreateLegInput) => request(`/api/trips/${tripId}/legs`, legSchema, input);

export const updateLegMode = (tripId: string, legId: string, mode: TravelMode) =>
  request(`/api/trips/${tripId}/legs/${legId}`, legSchema, { mode }, "PATCH");

// The server answers 204 with no body.
export const deleteLeg = (tripId: string, legId: string) => requestNothing(`/api/trips/${tripId}/legs/${legId}`, "DELETE");

// Sharing (PRD §8): the Owner's list of Editors and waiting invitations.
export const getSharing = (tripId: string) => request(`/api/trips/${tripId}/sharing`, sharingSchema);

export const inviteEditor = (tripId: string, email: string) => request(`/api/trips/${tripId}/invitations`, invitationSchema, { email });

export const revokeInvitation = (tripId: string, invitationId: string) => requestNothing(`/api/trips/${tripId}/invitations/${invitationId}`, "DELETE");

export const removeEditor = (tripId: string, editorId: string) => requestNothing(`/api/trips/${tripId}/editors/${editorId}`, "DELETE");

// The invitation page is for people who may not be logged in, so it sends no credentials.
// undefined: the link is not valid (any more).
export async function getInvitationPreview(token: string): Promise<InvitationPreview | undefined> {
  const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw await failure(res);
  return invitationPreviewSchema.parse(await res.json());
}

export type AcceptResult = { ok: true; trip: AcceptedInvitation } | { ok: false; reason: "wrong_account" | "email_not_verified" | "invitation_not_found" };

export async function acceptInvitation(token: string): Promise<AcceptResult> {
  const res = await send(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: "POST" });
  if (res.ok) return { ok: true, trip: acceptedInvitationSchema.parse(await res.json()) };
  const detail = (await res.clone().json().catch(() => undefined)) as { code?: string } | undefined;
  if (detail?.code === "wrong_account" || detail?.code === "email_not_verified" || detail?.code === "invitation_not_found") return { ok: false, reason: detail.code };
  throw await failure(res);
}

export const resendVerification = () => requestNothing("/api/me/resend-verification", "POST");

// The Trip behind a share link (a Viewer's view); the error code is "link_off" or "link_not_found".
export const getSharedTrip = (token: string) => requestPublic(`/api/shared/${encodeURIComponent(token)}`, tripSchema);

// Turns the Trip's read-only link on or off (the Owner's).
export const setShareLink = (tripId: string, enabled: boolean) => request(`/api/trips/${tripId}/link`, shareLinkSchema, { enabled }, "PUT");
