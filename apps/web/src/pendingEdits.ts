import type { EventFields } from "@travel-planner/shared";
import { z } from "zod";

// What an open Event panel held when the page had to leave for the login page (the popup was
// blocked). Kept in sessionStorage, so it survives the redirect in this tab and nowhere else.
const KEY = "travel-planner.pending-edits";

const pendingSchema = z.object({
  tripId: z.string(),
  // The Event being edited, or where a new Event was being set up.
  eventId: z.string().optional(),
  newEvent: z.object({ dayId: z.string(), startMinute: z.number(), durationMinutes: z.number() }).optional(),
  fields: z.object({
    title: z.string(),
    dayId: z.string(),
    kind: z.enum(["attraction", "meal", "lodging", "transport"]),
    start: z.string(),
    duration: z.string(),
    arrival: z.string(),
    transportLabel: z.string(),
    nights: z.string(),
    checkIn: z.string(),
    checkOut: z.string(),
    description: z.string(),
    phone: z.string(),
    email: z.string(),
    website: z.string(),
    bookingUrl: z.string(),
    placeId: z.string(),
    destinationId: z.string(),
  }),
});

export type PendingEdits = {
  tripId: string;
  eventId?: string;
  newEvent?: { dayId: string; startMinute: number; durationMinutes: number };
  fields: EventFields;
};

export function keepPendingEdits(edits: PendingEdits) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(edits));
  } catch {
    // Without storage the edits are lost with the page; nothing else can be done.
  }
}

// Reads what was kept and forgets it, so it is restored once.
export function takePendingEdits(): PendingEdits | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return undefined;
    sessionStorage.removeItem(KEY);
    const parsed = pendingSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
