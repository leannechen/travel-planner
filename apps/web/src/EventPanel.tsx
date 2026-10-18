import {
  arrivalOf,
  durationBetween,
  EVENT_KINDS,
  formatMinute,
  MAX_DURATION_MINUTES,
  parseTime,
  TRANSPORT_LABELS,
  planEventSave,
  type EventFields,
  type CreateEventInput,
  type Day,
  type Event,
  type UpdateEventInput,
} from "@travel-planner/shared";
import { KIND_NAMES, KindIcon, TRANSPORT_LABEL_NAMES } from "./kinds";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

// The time fields for a start and duration; a Transport event shows the arrival instead of the duration.
function timeFields(startMinute: number, durationMinutes: number) {
  return {
    start: formatMinute(startMinute),
    duration: String(durationMinutes),
    arrival: formatMinute(arrivalOf(startMinute, durationMinutes).minute),
  };
}

// The duration the typed fields stand for, or undefined while they are not valid.
function typedDuration(fields: EventFields) {
  const start = parseTime(fields.start);
  if (fields.kind === "transport") {
    const arrival = parseTime(fields.arrival);
    return start === undefined || arrival === undefined ? undefined : durationBetween(start, arrival);
  }
  const minutes = Number(fields.duration);
  return Number.isInteger(minutes) && minutes >= 1 ? minutes : undefined;
}

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


// Edits one Event. Fields are saved when the user leaves them or presses Enter, not on every
// keystroke. A new Event is created once it has a title. Remount it (key) for another Event.
export function EventPanel({ days, event, newEvent, onCreate, onUpdate, onDraftChange, onClose }: Props) {
  const initial = event ?? { title: "", kind: "attraction" as const, transportLabel: null, ...newEvent! };
  const [fields, setFields] = useState<EventFields>({
    title: initial.title,
    dayId: initial.dayId,
    kind: initial.kind,
    transportLabel: initial.transportLabel ?? "",
    ...timeFields(initial.startMinute, initial.durationMinutes),
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // The saved Event; for a new one this is set after it has been created.
  const saved = useRef<Event | undefined>(event);
  // Saves run one after another, each reading the latest fields when it starts.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The fields as last typed; change() is the only writer, so a queued save never sees stale text.
  const latest = useRef(fields);

  // What this panel last sent for the time, so its own saves are not mistaken for outside changes.
  const lastSent = useRef<{ startMinute: number; durationMinutes: number } | undefined>(undefined);

  // The time can change from outside while the panel is open (drag or resize on the axis); the
  // effect reacts to the Event's time only.
  useEffect(() => {
    const current = saved.current;
    if (!event || !current) return;
    if (event.startMinute === current.startMinute && event.durationMinutes === current.durationMinutes) return;
    const sent = lastSent.current;
    if (sent && event.startMinute === sent.startMinute && event.durationMinutes === sent.durationMinutes) return;
    saved.current = { ...current, startMinute: event.startMinute, durationMinutes: event.durationMinutes };
    change(timeFields(event.startMinute, event.durationMinutes));
  }, [event?.startMinute, event?.durationMinutes]);

  function change(next: Partial<EventFields>) {
    const merged = { ...latest.current, ...next };
    latest.current = merged;
    setFields(merged);
    if (!saved.current) {
      const startMinute = parseTime(merged.start);
      const durationMinutes = typedDuration(merged);
      if (startMinute !== undefined && durationMinutes !== undefined) {
        onDraftChange({ dayId: merged.dayId, startMinute, durationMinutes });
      }
    }
  }

  // Moving between Transport and the other kinds keeps the same times: the duration and the
  // arrival describe one thing, so the field that was hidden is recalculated from the shown one.
  function changeKind(kind: EventFields["kind"]) {
    const current = latest.current;
    const start = parseTime(current.start);
    const duration = typedDuration(current);
    change({ kind, ...(start !== undefined && duration !== undefined ? timeFields(start, duration) : {}) });
    commit();
  }

  function commit() {
    queue.current = queue.current.then(save);
  }

  async function save() {
    const current = saved.current;
    const plan = planEventSave(latest.current, current);
    if (plan.kind === "wait") return;
    if (plan.kind === "nothing") {
      setStatus({ kind: "idle" });
      return;
    }
    if (plan.kind === "error") {
      setStatus({ kind: "error", message: plan.message });
      return;
    }

    if (plan.kind === "update" && current) {
      lastSent.current = {
        startMinute: plan.patch.startMinute ?? current.startMinute,
        durationMinutes: plan.patch.durationMinutes ?? current.durationMinutes,
      };
    }
    setStatus({ kind: "saving" });
    try {
      saved.current =
        plan.kind === "update"
          ? await onUpdate(current!.id, plan.patch)
          : await onCreate(plan.input, plan.dayId);
      setStatus({ kind: "saved" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    commit();
  }

  const start = parseTime(fields.start);
  const shownDuration = typedDuration(fields);
  const arrivesNextDay =
    start !== undefined && shownDuration !== undefined && arrivalOf(start, shownDuration).dayOffset > 0;

  return (
    <aside
      className="event-panel"
      aria-label="Event"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // The field being edited will not blur once the panel is gone, so save it first.
          commit();
          onClose();
        }
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
        <fieldset className="kind-switch">
          <legend>Kind</legend>
          {EVENT_KINDS.map((kind) => (
            <label key={kind} className={`kind-${kind}`}>
              <input
                type="radio"
                name="kind"
                value={kind}
                checked={fields.kind === kind}
                onChange={() => changeKind(kind)}
              />
              <KindIcon kind={kind} transportLabel={null} />
              {KIND_NAMES[kind]}
            </label>
          ))}
        </fieldset>
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
          {fields.kind === "transport" ? "Departure" : "Start"}
          <input
            type="time"
            value={fields.start}
            onChange={(e) => change({ start: e.target.value })}
            onBlur={commit}
          />
        </label>
        {fields.kind === "transport" ? (
          <>
            <label>
              Arrival
              <input
                type="time"
                value={fields.arrival}
                onChange={(e) => change({ arrival: e.target.value })}
                onBlur={commit}
              />
              {arrivesNextDay && <span className="hint">+1 (next day)</span>}
            </label>
            <label>
              Transport type
              <select
                value={fields.transportLabel}
                onChange={(e) => {
                  change({ transportLabel: e.target.value });
                  commit();
                }}
              >
                <option value="">None</option>
                {TRANSPORT_LABELS.map((label) => (
                  <option key={label} value={label}>
                    {TRANSPORT_LABEL_NAMES[label]}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
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
        )}
        {/* Lets Enter submit from any field without a visible button. */}
        <button type="submit" hidden />
      </form>
      {status.kind === "error" && <p role="alert">{status.message}</p>}
    </aside>
  );
}
