import {
  daySchema,
  eventSchema,
  tripSchema,
  type CreateEventInput,
  type CreateTripInput,
} from "@travel-planner/shared";
import { z } from "zod";

type Method = "GET" | "POST" | "PUT" | "DELETE";

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

export const deleteDay = (tripId: string, dayId: string) =>
  request(`/api/trips/${tripId}/days/${dayId}`, daysSchema, undefined, "DELETE");
