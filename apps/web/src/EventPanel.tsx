import {
  formatMinute,
  MAX_DURATION_MINUTES,
  parseTime,
  type CreateEventInput,
  type Day,
  type Event,
  type UpdateEventInput,
} from "@travel-planner/shared";
import { useRef, useState, type FormEvent } from "react";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

type Props = {
  days: Day[];
  // The Event being edited, or the starting values of a new Event.
  event?: Event;
  newEvent?: { dayId: string; startMinute: number; durationMinutes: number };
  onCreate: (input: CreateEventInput, dayId: string) => Promise<Event>;
  onUpdate: (eventId: string, input: UpdateEventInput) => Promise<Event>;
  // Reports the values being typed for a new Event, so the placeholder follows them.
  onDraftChange: (draft: { dayId: string; startMinute: number; durationMinutes: number }) => void;
  onClose: () => void;
};

type Fields = { title: string; dayId: string; start: string; duration: string };

// Edits one Event. Fields are saved when the user leaves them or presses Enter, not on every
// keystroke. A new Event is created once it has a title. Remount it (key) for another Event.
export function EventPanel({ days, event, newEvent, onCreate, onUpdate, onDraftChange, onClose }: Props) {
  const initial = event ?? { title: "", ...newEvent! };
  const [fields, setFields] = useState<Fields>({
    title: initial.title,
    dayId: initial.dayId,
    start: formatMinute(initial.startMinute),
    duration: String(initial.durationMinutes),
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // The saved Event; for a new one this is set after it has been created.
  const saved = useRef<Event | undefined>(event);
  // Saves run one after another, each reading the latest fields when it starts.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(fields);
  latest.current = fields;

  function change(next: Partial<Fields>) {
    const merged = { ...latest.current, ...next };
    latest.current = merged;
    setFields(merged);
    if (!saved.current) {
      const startMinute = parseTime(merged.start);
      const durationMinutes = Number(merged.duration);
      if (startMinute !== undefined && Number.isInteger(durationMinutes) && durationMinutes >= 1) {
        onDraftChange({ dayId: merged.dayId, startMinute, durationMinutes });
      }
    }
  }

  function commit() {
    queue.current = queue.current.then(save);
  }

  async function save() {
    const f = latest.current;
    const title = f.title.trim();
    const startMinute = parseTime(f.start);
    const durationMinutes = Number(f.duration);
    const current = saved.current;

    if (!title) {
      // A new Event waits for its title; an existing one cannot lose it.
      if (current) setStatus({ kind: "error", message: "Title is required" });
      return;
    }
    if (
      startMinute === undefined ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > MAX_DURATION_MINUTES
    ) {
      setStatus({
        kind: "error",
        message: `Enter a start time and a duration of 1 to ${MAX_DURATION_MINUTES} whole minutes`,
      });
      return;
    }

    const patch: UpdateEventInput = {};
    if (current) {
      if (title !== current.title) patch.title = title;
      if (f.dayId !== current.dayId) patch.dayId = f.dayId;
      if (startMinute !== current.startMinute) patch.startMinute = startMinute;
      if (durationMinutes !== current.durationMinutes) patch.durationMinutes = durationMinutes;
      if (Object.keys(patch).length === 0) return;
    }

    setStatus({ kind: "saving" });
    try {
      saved.current = current
        ? await onUpdate(current.id, patch)
        : await onCreate({ title, startMinute, durationMinutes }, f.dayId);
      setStatus({ kind: "saved" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    commit();
  }

  return (
    <aside
      className="event-panel"
      aria-label="Event"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="panel-top">
        <span className="panel-status" role="status">
          {status.kind === "saving" && "Saving…"}
          {status.kind === "saved" && "Saved"}
        </span>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <label>
          Title
          <input
            autoFocus
            value={fields.title}
            onChange={(e) => change({ title: e.target.value })}
            onBlur={commit}
          />
        </label>
        <label>
          Day
          <select
            value={fields.dayId}
            onChange={(e) => {
              change({ dayId: e.target.value });
              commit();
            }}
          >
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                Day {d.position}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start
          <input
            type="time"
            value={fields.start}
            onChange={(e) => change({ start: e.target.value })}
            onBlur={commit}
          />
        </label>
        <label>
          Duration (minutes)
          <input
            type="number"
            min={1}
            max={MAX_DURATION_MINUTES}
            value={fields.duration}
            onChange={(e) => change({ duration: e.target.value })}
            onBlur={commit}
          />
        </label>
        {/* Lets Enter submit from any field without a visible button. */}
        <button type="submit" hidden />
      </form>
      {status.kind === "error" && <p role="alert">{status.message}</p>}
    </aside>
  );
}
