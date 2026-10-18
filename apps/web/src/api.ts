import {
  daySchema,
  dayDeletionSchema,
  eventSchema,
  tripSchema,
  type CreateEventInput,
  type CreateTripInput,
  type HoldingArea,
  type RestoreDayInput,
  type UpdateEventInput,
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
