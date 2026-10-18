import { parseTime } from "./time-layout";
import { durationBetween } from "./transport";
import { MAX_DURATION_MINUTES, TRANSPORT_LABELS } from "./index";
import type { CreateEventInput, Event, UpdateEventInput } from "./index";

// What the edit panel holds as text. `arrival` is used for Transport events, where the duration
// is derived from it; `duration` is used for the other kinds. `transportLabel` is "" for none.
export type EventFields = {
  title: string;
  dayId: string;
  kind: Event["kind"];
  start: string;
  duration: string;
  arrival: string;
  transportLabel: string;
};

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
  const durationMinutes = fields.kind === "transport" ? transportDuration(startMinute, fields.arrival) : typedDuration(fields.duration);
  if (startMinute === undefined || durationMinutes === undefined) {
    return {
      kind: "error",
      message:
        fields.kind === "transport"
          ? "Enter a departure time and a different arrival time"
          : `Enter a start time and a duration of 1 to ${MAX_DURATION_MINUTES} whole minutes`,
    };
  }
  const transportLabel = TRANSPORT_LABELS.find((label) => label === fields.transportLabel) ?? null;

  if (!saved) return { kind: "create", dayId: fields.dayId, input: { title, kind: fields.kind, startMinute, durationMinutes, transportLabel } };

  const patch: UpdateEventInput = {};
  if (title !== saved.title) patch.title = title;
  if (fields.dayId !== saved.dayId) patch.dayId = fields.dayId;
  if (fields.kind !== saved.kind) patch.kind = fields.kind;
  if (transportLabel !== saved.transportLabel) patch.transportLabel = transportLabel;
  if (startMinute !== saved.startMinute) patch.startMinute = startMinute;
  if (durationMinutes !== saved.durationMinutes) patch.durationMinutes = durationMinutes;
  return Object.keys(patch).length === 0 ? { kind: "nothing" } : { kind: "update", patch };
}

// The minutes typed in the Duration field, or undefined while they are not a valid duration.
export function typedDuration(text: string): number | undefined {
  const minutes = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_DURATION_MINUTES;
  return valid ? minutes : undefined;
}

function transportDuration(startMinute: number | undefined, arrival: string): number | undefined {
  const arrivalMinute = parseTime(arrival);
  if (startMinute === undefined || arrivalMinute === undefined) return undefined;
  return durationBetween(startMinute, arrivalMinute);
}
