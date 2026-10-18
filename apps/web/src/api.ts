import {
  daySchema,
  dayDeletionSchema,
  deletedEventSchema,
  eventSchema,
  meSchema,
  todoSchema,
  tripSchema,
  type CreateEventInput,
  type CreateTripInput,
  type DeletedEvent,
  type HoldingArea,
  type RestoreDayInput,
  type UpdateEventInput,
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

export const listTrips = () => request("/api/trips", z.array(tripSchema));

export const createTrip = (input: CreateTripInput) => request("/api/trips", tripSchema, input);

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
