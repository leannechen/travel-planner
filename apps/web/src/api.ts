import {
  daySchema,
  dayDeletionSchema,
  deletedEventSchema,
  eventSchema,
  legSchema,
  meSchema,
  noteSchema,
  openingHoursSchema,
  placeSchema,
  todoSchema,
  startDateSchema,
  tripSchema,
  type CreateEventInput,
  type CreateLegInput,
  type CreateTripInput,
  type DeletedEvent,
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

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  method: Method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(detail?.error ?? `Request failed: ${res.status}`);
  }
  return schema.parse(await res.json());
}

const placesSchema = z.object({ places: z.array(placeSchema) });

export const searchPlaces = (query: string) =>
  request(`/api/places/search?q=${encodeURIComponent(query)}`, placesSchema).then((r) => r.places);

export const getPlaces = (ids: string[]) =>
  request(`/api/places?ids=${encodeURIComponent(ids.join(","))}`, placesSchema).then((r) => r.places);

// Opening hours by place id; a place without hours is left out.
export const getOpeningHours = (ids: string[]) =>
  request(`/api/places/opening-hours?ids=${encodeURIComponent(ids.join(","))}`, z.object({ openingHours: z.record(z.string(), openingHoursSchema) })).then(
    (r) => new Map(Object.entries(r.openingHours)),
  );

export const listTrips = () => request("/api/trips", z.array(tripSchema));

export const createTrip = (input: CreateTripInput) => request("/api/trips", tripSchema, input);

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
export async function deleteTodo(tripId: string, todoId: string): Promise<void> {
  const res = await fetch(`/api/trips/${tripId}/todos/${todoId}`, { method: "DELETE" });
  if (!res.ok) {
    const detail = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(detail?.error ?? `Request failed: ${res.status}`);
  }
}

// Deletes an Event with its Todos; the answer is what restoreEvent needs to undo it.
export const deleteEvent = (tripId: string, eventId: string) =>
  request(`/api/trips/${tripId}/events/${eventId}`, deletedEventSchema, undefined, "DELETE");

export const restoreEvent = (tripId: string, deleted: DeletedEvent) =>
  request(`/api/trips/${tripId}/events/restore`, eventSchema, deleted);

export const addNote = (tripId: string, body: string) => request(`/api/trips/${tripId}/notes`, noteSchema, { body });

export const updateNote = (tripId: string, noteId: string, input: UpdateNoteInput) =>
  request(`/api/trips/${tripId}/notes/${noteId}`, noteSchema, input, "PATCH");

export async function deleteNote(tripId: string, noteId: string): Promise<void> {
  const res = await fetch(`/api/trips/${tripId}/notes/${noteId}`, { method: "DELETE" });
  if (!res.ok) {
    const detail = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(detail?.error ?? `Request failed: ${res.status}`);
  }
}

export const restoreNote = (tripId: string, note: Note) => request(`/api/trips/${tripId}/notes/restore`, noteSchema, { note });

export const listLegs = (tripId: string) => request(`/api/trips/${tripId}/legs`, z.array(legSchema));

export const createLeg = (tripId: string, input: CreateLegInput) => request(`/api/trips/${tripId}/legs`, legSchema, input);

export const updateLegMode = (tripId: string, legId: string, mode: TravelMode) =>
  request(`/api/trips/${tripId}/legs/${legId}`, legSchema, { mode }, "PATCH");

// The server answers 204 with no body.
export async function deleteLeg(tripId: string, legId: string): Promise<void> {
  const res = await fetch(`/api/trips/${tripId}/legs/${legId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
}
