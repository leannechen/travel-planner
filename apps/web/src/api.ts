import {
  eventSchema,
  tripSchema,
  type CreateEventInput,
  type CreateTripInput,
} from "@travel-planner/shared";
import { z } from "zod";

async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return schema.parse(await res.json());
}

export const listTrips = () => request("/api/trips", z.array(tripSchema));

export const createTrip = (input: CreateTripInput) => request("/api/trips", tripSchema, input);

export const addEvent = (tripId: string, dayId: string, input: CreateEventInput) =>
  request(`/api/trips/${tripId}/days/${dayId}/events`, eventSchema, input);
