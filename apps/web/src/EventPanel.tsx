import {
  arrivalOf,
  durationBetween,
  EVENT_KINDS,
  formatMinute,
  MAX_DURATION_MINUTES,
  MAX_NIGHTS,
  isHoldingArea,
  isWebUrl,
  parseTime,
  TRANSPORT_LABELS,
  typedDuration,
  planEventSave,
  showsBookingLink,
  showsContact,
  type EventFields,
  type CreateEventInput,
  type Day,
  type Event,
  type Todo,
  type UpdateEventInput,
} from "@travel-planner/shared";
import { TodoList } from "./TodoList";
import { KIND_NAMES, KindIcon, TRANSPORT_LABEL_NAMES } from "./kinds";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";

// The editor is large, so it is loaded when the first panel opens, not with the page.
const MarkdownEditor = lazy(() => import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })));

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
function fieldsDuration(fields: EventFields) {
  // Outside a Day there is no departure to arrive from, so a Transport event has a duration too.
  if (fields.kind !== "transport" || isHoldingArea(fields.dayId)) return typedDuration(fields.duration);
  const start = parseTime(fields.start);
  const arrival = parseTime(fields.arrival);
  return start === undefined || arrival === undefined ? undefined : durationBetween(start, arrival);
}

// Where an Event is: a Day id, or the name of its holding area.
const placeOf = (event: { dayId: string | null; holding?: Event["holding"] }) => event.dayId ?? event.holding ?? "backlog";

const hasContact = (event: { phone: string | null; email: string | null; website: string | null }) =>
  Boolean(event.phone || event.email || event.website);

type Props = {
  days: Day[];
  // The Event being edited, or the starting values of a new Event.
  event?: Event;
  // `dayId` is a Day id, or "backlog" or "archive".
  newEvent?: { dayId: string; startMinute: number; durationMinutes: number };
  onCreate: (input: CreateEventInput, place: string) => Promise<Event>;
  onUpdate: (eventId: string, input: UpdateEventInput) => Promise<Event>;
  // Reports the values being typed for a new Event, so the placeholder follows them.
  onDraftChange: (draft: { dayId: string; startMinute: number; durationMinutes: number; kind: Event["kind"] }) => void;
  onClose: () => void;
  // Only for a saved Event; a new one has neither Todos nor anything to delete yet.
  todos: Todo[];
  onAddTodo: (text: string, eventId: string) => Promise<void>;
  onToggleTodo: (todo: Todo) => void;
  onDeleteTodo: (todo: Todo) => void;
  onDelete: (event: Event) => void;
};


// Edits one Event. Fields are saved when the user leaves them or presses Enter, not on every
// keystroke. A new Event is created once it has a title. Remount it (key) for another Event.
export function EventPanel({
  days,
  event,
  newEvent,
  onCreate,
  onUpdate,
  onDraftChange,
  onClose,
  todos,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  onDelete,
}: Props) {
  const initial = event ?? {
    title: "",
    kind: "attraction" as const,
    transportLabel: null,
    nights: null,
    checkInMinute: null,
    checkOutMinute: null,
    description: null,
    phone: null,
    email: null,
    website: null,
    bookingUrl: null,
    ...newEvent!,
  };
  const [fields, setFields] = useState<EventFields>({
    title: initial.title,
    dayId: placeOf(initial),
    kind: initial.kind,
    transportLabel: initial.transportLabel ?? "",
    nights: String(initial.nights ?? 1),
    checkIn: initial.checkInMinute === null ? "" : formatMinute(initial.checkInMinute),
    checkOut: initial.checkOutMinute === null ? "" : formatMinute(initial.checkOutMinute),
    description: initial.description ?? "",
    phone: initial.phone ?? "",
    email: initial.email ?? "",
    website: initial.website ?? "",
    bookingUrl: initial.bookingUrl ?? "",
    ...timeFields(initial.startMinute, initial.durationMinutes),
  });
  // Open from the start when there is something to show; after that only the user changes it.
  const [contactOpen] = useState(() => hasContact(initial));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // The saved Event; for a new one this is set after it has been created.
  const saved = useRef<Event | undefined>(event);
  // Saves run one after another, each reading the latest fields when it starts.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The fields as last typed; change() is the only writer, so a queued save never sees stale text.
  const latest = useRef(fields);

  // What this panel last sent for the time and place, so its own saves are not mistaken for
  // outside changes.
  const lastSent = useRef<{ startMinute: number; durationMinutes: number; place: string } | undefined>(undefined);

  // The time and place can change from outside while the panel is open (drag or resize on the
  // axis, a drag to another area); the effect reacts to those only.
  const place = event ? placeOf(event) : undefined;
  useEffect(() => {
    const current = saved.current;
    if (!event || !current || place === undefined) return;
    const same = (a: { startMinute: number; durationMinutes: number }, p: string) =>
      event.startMinute === a.startMinute && event.durationMinutes === a.durationMinutes && place === p;
    if (same(current, placeOf(current))) return;
    const sent = lastSent.current;
    if (sent && same(sent, sent.place)) return;
    saved.current = {
      ...current,
      startMinute: event.startMinute,
      durationMinutes: event.durationMinutes,
      dayId: event.dayId,
      holding: event.holding,
    };
    change({ dayId: place, ...timeFields(event.startMinute, event.durationMinutes) });
  }, [event?.startMinute, event?.durationMinutes, place]);

  function change(next: Partial<EventFields>) {
    const merged = { ...latest.current, ...next };
    latest.current = merged;
    setFields(merged);
    if (!saved.current) {
      const startMinute = parseTime(merged.start);
      const durationMinutes = fieldsDuration(merged);
      if (startMinute !== undefined && durationMinutes !== undefined) {
        onDraftChange({ dayId: merged.dayId, startMinute, durationMinutes, kind: merged.kind });
      }
    }
  }

  // Moving between kinds keeps the same times: the duration and the arrival describe one thing, so
  // the field that was hidden is recalculated from the shown one. A Lodging's check-in time is its
  // start time on the way in and back out (PRD §3.2); its duration is kept hidden meanwhile.
  function changeKind(kind: EventFields["kind"]) {
    const current = latest.current;
    // An invalid time field must not leave the hidden one stale: fall back to the saved Event.
    const start =
      (current.kind === "lodging" ? parseTime(current.checkIn) : undefined) ??
      parseTime(current.start) ??
      saved.current?.startMinute;
    const duration = fieldsDuration(current) ?? saved.current?.durationMinutes;
    const checkIn = kind === "lodging" && current.checkIn.trim() === "" && start !== undefined ? { checkIn: formatMinute(start) } : {};
    change({ kind, ...checkIn, ...(start !== undefined && duration !== undefined ? timeFields(start, duration) : {}) });
    commit();
  }

  // Moving between a Day and a holding area keeps the same duration: a Transport event is shown by
  // its arrival on a Day and by its duration outside, so the hidden field is recalculated.
  function changePlace(place: string) {
    const current = latest.current;
    const start = parseTime(current.start) ?? saved.current?.startMinute;
    const duration = fieldsDuration(current) ?? saved.current?.durationMinutes;
    change({ dayId: place });
    if (start !== undefined && duration !== undefined) change(timeFields(start, duration));
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
        place: plan.patch.area ?? plan.patch.dayId ?? placeOf(current),
      };
    }
    setStatus({ kind: "saving" });
    try {
      saved.current =
        plan.kind === "update"
          ? await onUpdate(current!.id, plan.patch)
          : await onCreate(plan.input, plan.dayId);
      setStatus({ kind: "saved" });
      // A move to the Archive the user declined leaves the Event where it was; show that.
      const result = saved.current;
      if (plan.kind === "update" && plan.patch.area && result && result.holding !== plan.patch.area) {
        // Declined, so nothing was saved: forget what was sent and show the place it still has.
        lastSent.current = undefined;
        change({ dayId: placeOf(result) });
        setStatus({ kind: "idle" });
      }
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    commit();
  }

  const start = parseTime(fields.start);
  const shownDuration = fieldsDuration(fields);
  const held = isHoldingArea(fields.dayId);
  const arrivesNextDay =
    fields.kind === "transport" && !held &&
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
          {fields.kind === "lodging" ? "Check-in Day" : "Day"}
          <select value={fields.dayId} onChange={(e) => changePlace(e.target.value)}>
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                Day {d.position}
              </option>
            ))}
            <option value="backlog">Backlog (not scheduled)</option>
            <option value="archive">Archive</option>
          </select>
        </label>
        {fields.kind === "lodging" ? (
          <>
            <label>
              Nights
              <input
                type="number"
                min={1}
                max={MAX_NIGHTS}
                value={fields.nights}
                onChange={(e) => change({ nights: e.target.value })}
                onBlur={commit}
              />
            </label>
            <label>
              Check-in time (optional)
              <input
                type="time"
                value={fields.checkIn}
                onChange={(e) => change({ checkIn: e.target.value })}
                onBlur={commit}
              />
            </label>
            <label>
              Check-out time (optional)
              <input
                type="time"
                value={fields.checkOut}
                onChange={(e) => change({ checkOut: e.target.value })}
                onBlur={commit}
              />
            </label>
          </>
        ) : (
          <>
            {!held && (
              <label>
                {fields.kind === "transport" ? "Departure" : "Start"}
                <input
                  type="time"
                  value={fields.start}
                  onChange={(e) => change({ start: e.target.value })}
                  onBlur={commit}
                />
              </label>
            )}
            {fields.kind === "transport" && !held ? (
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
            {fields.kind === "transport" && (
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
            )}
          </>
        )}
        {showsBookingLink(fields.kind) && (
          <label>
            Booking link
            <input
              type="url"
              value={fields.bookingUrl}
              onChange={(e) => change({ bookingUrl: e.target.value })}
              onBlur={commit}
            />
            {isWebUrl(fields.bookingUrl.trim()) && (
              <a href={fields.bookingUrl.trim()} target="_blank" rel="noreferrer">
                Open link
              </a>
            )}
          </label>
        )}
        {showsContact(fields.kind) && (
          <details className="contact" open={contactOpen}>
            <summary>Contact</summary>
            <label>
              Phone
              <input type="tel" value={fields.phone} onChange={(e) => change({ phone: e.target.value })} onBlur={commit} />
            </label>
            <label>
              Email
              <input type="email" value={fields.email} onChange={(e) => change({ email: e.target.value })} onBlur={commit} />
            </label>
            <label>
              Website
              <input type="url" value={fields.website} onChange={(e) => change({ website: e.target.value })} onBlur={commit} />
              {isWebUrl(fields.website.trim()) && (
                <a href={fields.website.trim()} target="_blank" rel="noreferrer">
                  Open website
                </a>
              )}
            </label>
          </details>
        )}
        <div className="field">
          <span>Description</span>
          <Suspense fallback={<div className="md-editor-loading">Loading editor…</div>}>
            <MarkdownEditor
              label="Description"
              value={initial.description ?? ""}
              onChange={(description) => change({ description })}
              onBlur={commit}
            />
          </Suspense>
        </div>
        {/* Lets Enter submit from any field without a visible button. */}
        <button type="submit" hidden />
      </form>
      {status.kind === "error" && <p role="alert">{status.message}</p>}
      {event && event.holding !== "archive" && (
        <section className="event-todos">
          <h4>
            Event Todos <span className="count">{todos.length}</span>
          </h4>
          <TodoList
            todos={todos}
            label="Event Todos"
            addLabel="Add an Event Todo"
            onAdd={(text) => onAddTodo(text, event.id)}
            onToggle={onToggleTodo}
            onDelete={onDeleteTodo}
          />
        </section>
      )}
      {event && (
        <button type="button" className="danger delete-event" onClick={() => onDelete(event)}>
          Delete Event
        </button>
      )}
    </aside>
  );
}
