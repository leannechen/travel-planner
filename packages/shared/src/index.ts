import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

const title = z.string().trim().min(1, "Title is required").max(200);

// Minutes from 00:00 of the Day. An Event may run past midnight; the axis cuts it off there.
export const MAX_DURATION_MINUTES = 1440;
const startMinute = z.number().int().min(0).max(1439);
const durationMinutes = z.number().int().min(1).max(MAX_DURATION_MINUTES);

export const DEFAULT_START_MINUTE = 9 * 60;
export const DEFAULT_DURATION_MINUTES = 60;

export const eventSchema = z.object({
  id: z.uuid(),
  dayId: z.uuid(),
  title,
  startMinute,
  durationMinutes,
});

export const daySchema = z.object({
  id: z.uuid(),
  position: z.number().int().positive(),
  events: z.array(eventSchema),
});

export const tripSchema = z.object({
  id: z.uuid(),
  title,
  days: z.array(daySchema),
});

export const createTripInputSchema = z.object({ title });
export const createEventInputSchema = z.object({
  title,
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

export type CreateDayInput = z.infer<typeof createDayInputSchema>;
export type ReorderDaysInput = z.infer<typeof reorderDaysInputSchema>;

export * from "./day-order";
export * from "./time-layout";
