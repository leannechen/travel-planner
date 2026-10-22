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
    placePhotoHidden: z.boolean().default(false),
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

// What was kept, if anything. It stays until `clearPendingEdits`, so reading it twice (React may run an
// initializer twice) cannot lose it.
export function peekPendingEdits(): PendingEdits | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return undefined;
    const parsed = pendingSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function clearPendingEdits() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to remove.
  }
}

// A message for the page after it reloads (the account changed under unsaved edits).
const NOTICE_KEY = "travel-planner.notice";

export function keepNotice() {
  try {
    sessionStorage.setItem(NOTICE_KEY, "other-account");
  } catch {
    // The reload then happens without a message.
  }
}

export function peekNotice(): boolean {
  try {
    return sessionStorage.getItem(NOTICE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearNotice() {
  try {
    sessionStorage.removeItem(NOTICE_KEY);
  } catch {
    // Nothing to remove.
  }
}
