import { z } from "zod";

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

export const eventSchema = z.object({
  id: z.uuid(),
  dayId: z.uuid(),
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
    dayId: z.uuid().optional(),
    startMinute: startMinute.optional(),
    durationMinutes: durationMinutes.optional(),
  })
  .refine((input) => Object.values(input).some((v) => v !== undefined), {
    message: "Provide at least one field to change",
  });

export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;

export type CreateDayInput = z.infer<typeof createDayInputSchema>;
export type ReorderDaysInput = z.infer<typeof reorderDaysInputSchema>;

export * from "./day-order";
export * from "./event-list";
export * from "./event-save";
export * from "./lodging-range";
export * from "./time-edit";
export * from "./time-layout";
export * from "./transport";
