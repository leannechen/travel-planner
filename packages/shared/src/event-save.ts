import { parseTime } from "./time-layout";
import { MAX_DURATION_MINUTES } from "./index";
import type { CreateEventInput, Event, UpdateEventInput } from "./index";

export type EventFields = { title: string; dayId: string; start: string; duration: string };

export type SavePlan =
  | { kind: "wait" } // a new Event without a title yet
  | { kind: "nothing" } // nothing differs from what is saved
  | { kind: "error"; message: string }
  | { kind: "create"; dayId: string; input: CreateEventInput }
  | { kind: "update"; patch: UpdateEventInput };

// Decides what saving the edit panel's fields means: validate them, then either create a new
// Event, send only what changed, or do nothing.
export function planEventSave(fields: EventFields, saved: Event | undefined): SavePlan {
  const title = fields.title.trim();
  if (!title) return saved ? { kind: "error", message: "Title is required" } : { kind: "wait" };

  const startMinute = parseTime(fields.start);
  const durationMinutes = Number(fields.duration);
  if (
    startMinute === undefined ||
    fields.duration.trim() === "" ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > MAX_DURATION_MINUTES
  ) {
    return {
      kind: "error",
      message: `Enter a start time and a duration of 1 to ${MAX_DURATION_MINUTES} whole minutes`,
    };
  }

  if (!saved) return { kind: "create", dayId: fields.dayId, input: { title, startMinute, durationMinutes } };

  const patch: UpdateEventInput = {};
  if (title !== saved.title) patch.title = title;
  if (fields.dayId !== saved.dayId) patch.dayId = fields.dayId;
  if (startMinute !== saved.startMinute) patch.startMinute = startMinute;
  if (durationMinutes !== saved.durationMinutes) patch.durationMinutes = durationMinutes;
  return Object.keys(patch).length === 0 ? { kind: "nothing" } : { kind: "update", patch };
}
