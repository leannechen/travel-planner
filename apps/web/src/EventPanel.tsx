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
import { PlaceField } from "./PlaceField";
import { TodoList } from "./TodoList";
import { kindKey, KindIcon, transportKey } from "./kinds";
import { useT } from "./preferences";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useIsPhone } from "./phone";
import { tip } from "./shortcuts";
import { Archive, Check, ChevronDown, Trash2 } from "lucide-react";

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
  // Selected from the keyboard: leave the focus where it is so the arrow keys keep working.
  quiet?: boolean;
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
  quiet,
}: Props) {
  const t = useT();
  const phone = useIsPhone();
  // Phone footer: which of the split button's actions is chosen, and whether its menu is open.
  const [footerAction, setFooterAction] = useState<"archive" | "delete">("archive");
  const [menuOpen, setMenuOpen] = useState(false);
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
    placeId: null,
    destinationId: null,
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
    placeId: initial.placeId ?? "",
    destinationId: initial.destinationId ?? "",
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
  // Whether the last save failed.
  const failed = useRef(false);

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
    failed.current = plan.kind === "error";
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
      failed.current = true;
      setStatus({ kind: "error", message: err instanceof Error ? err.message : t("generic.error") });
    }
  }

  // The Archive/Delete menu closes on a click outside it or on Escape (marked handled, so the
  // sheet's own Escape stays out).
  const split = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      // A tap on the scrim is handled by the scrim, which only closes the menu.
      const target = e.target as HTMLElement;
      if (!split.current?.contains(target) && !target.closest(".sheet-scrim")) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  // Phone footer: closes the sheet once the pending changes are saved; a failed save keeps it open.
  async function finish() {
    commit();
    await queue.current;
    // A failed save keeps the sheet open, with the text and the error.
    if (!failed.current) onClose();
  }

  async function archiveAndClose() {
    changePlace("archive");
    await queue.current;
    // A declined or failed move leaves the Event where it was.
    if (saved.current?.holding === "archive") onClose();
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
    <>
    {/* Phone: the page behind the sheet cannot be used; tapping it closes the sheet like OK. */}
    {phone && <div className="sheet-scrim" onClick={() => (menuOpen ? setMenuOpen(false) : void finish())} />}
    <aside
      className="event-panel"
      aria-label={t("event.panel")}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // The field being edited will not blur once the panel is gone, so save it first.
          commit();
          onClose();
        }
      }}
    >
      {phone ? (
        <div className="sheet-handle" aria-hidden="true" />
      ) : (
        <div className="panel-top">
          <span className="panel-status" role="status">
            {status.kind === "saving" && t("generic.saving")}
            {status.kind === "saved" && t("generic.saved")}
          </span>
          <button type="button" onClick={onClose} aria-label={t("generic.close")} title={t("generic.closeEsc")}>
            ✕
          </button>
        </div>
      )}
      <div className="panel-body">
      <form onSubmit={handleSubmit}>
        {phone ? (
          <label className={`kind-select kind-${fields.kind}`}>
            <span className="visually-hidden">{t("event.kind")}</span>
            <KindIcon kind={fields.kind} transportLabel={null} />
            <select value={fields.kind} onChange={(e) => changeKind(e.target.value as EventFields["kind"])}>
              {EVENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(kindKey(kind))}
                </option>
              ))}
            </select>
            <ChevronDown size={18} aria-hidden="true" />
          </label>
        ) : (
        <fieldset className="kind-switch">
          <legend>{t("event.kind")}</legend>
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
              {t(kindKey(kind))}
            </label>
          ))}
        </fieldset>
        )}
        <label>
          {t("event.title")}
          <input
            autoFocus={!quiet}
            data-field="title"
            value={fields.title}
            onChange={(e) => change({ title: e.target.value })}
            onBlur={commit}
          />
        </label>
        <label>
          {fields.kind === "lodging" ? t("event.checkInDay") : t("event.day")}
          <select value={fields.dayId} onChange={(e) => changePlace(e.target.value)}>
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                {t("day.title", { n: d.position })}
              </option>
            ))}
            <option value="backlog">{t("event.backlogOption")}</option>
            <option value="archive">{t("area.archive")}</option>
          </select>
        </label>
        {phone && <p className="hint">{t("event.dayHint")}</p>}
        {fields.kind === "lodging" ? (
          <>
            <label>
              {t("event.nights")}
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
              {t("event.checkIn")}
              <input
                type="time"
                value={fields.checkIn}
                onChange={(e) => change({ checkIn: e.target.value })}
                onBlur={commit}
              />
            </label>
            <label>
              {t("event.checkOut")}
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
                {fields.kind === "transport" ? t("event.departure") : t("event.start")}
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
                {t("event.arrival")}
                <input
                  type="time"
                  value={fields.arrival}
                  onChange={(e) => change({ arrival: e.target.value })}
                  onBlur={commit}
                />
                {arrivesNextDay && <span className="hint">{t("event.nextDay")}</span>}
              </label>
            ) : (
              <label>
                {t("event.duration")}
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
                {t("event.transportType")}
                <select
                  value={fields.transportLabel}
                  onChange={(e) => {
                    change({ transportLabel: e.target.value });
                    commit();
                  }}
                >
                  <option value="">{t("event.none")}</option>
                  {TRANSPORT_LABELS.map((label) => (
                    <option key={label} value={label}>
                      {t(transportKey(label))}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {fields.kind === "transport" ? (
          <>
            <PlaceField
              label={t("place.from")}
              optional
              value={fields.placeId}
              onChange={(placeId) => {
                change({ placeId });
                commit();
              }}
            />
            <PlaceField
              label={t("place.to")}
              optional
              value={fields.destinationId}
              onChange={(destinationId) => {
                change({ destinationId });
                commit();
              }}
            />
          </>
        ) : (
          <PlaceField
            label={t("place.location")}
            value={fields.placeId}
            onChange={(placeId) => {
              change({ placeId });
              commit();
            }}
          />
        )}
        {showsBookingLink(fields.kind) && (
          <label>
            {t("event.bookingLink")}
            <input
              type="url"
              value={fields.bookingUrl}
              onChange={(e) => change({ bookingUrl: e.target.value })}
              onBlur={commit}
            />
            {isWebUrl(fields.bookingUrl.trim()) && (
              <a href={fields.bookingUrl.trim()} target="_blank" rel="noreferrer">
                {t("event.openLink")}
              </a>
            )}
          </label>
        )}
        {showsContact(fields.kind) && (
          <details className="contact" open={contactOpen}>
            <summary>{t("event.contact")}</summary>
            <label>
              {t("event.phone")}
              <input type="tel" value={fields.phone} onChange={(e) => change({ phone: e.target.value })} onBlur={commit} />
            </label>
            <label>
              {t("event.email")}
              <input type="email" value={fields.email} onChange={(e) => change({ email: e.target.value })} onBlur={commit} />
            </label>
            <label>
              {t("event.website")}
              <input type="url" value={fields.website} onChange={(e) => change({ website: e.target.value })} onBlur={commit} />
              {isWebUrl(fields.website.trim()) && (
                <a href={fields.website.trim()} target="_blank" rel="noreferrer">
                  {t("event.openWebsite")}
                </a>
              )}
            </label>
          </details>
        )}
        <div className="field">
          <span>{t("event.description")}</span>
          <Suspense fallback={<div className="md-editor-loading">{t("event.loadingEditor")}</div>}>
            <MarkdownEditor
              label={t("event.description")}
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
            {t("event.todos")} <span className="count">{todos.length}</span>
          </h4>
          <TodoList
            todos={todos}
            label={t("event.todos")}
            addLabel={t("event.addTodo")}
            onAdd={(text) => onAddTodo(text, event.id)}
            onToggle={onToggleTodo}
            onDelete={onDeleteTodo}
          />
        </section>
      )}
      {event && !phone && (
        <button type="button" className="danger delete-event" title={tip(t("event.delete"), "delete")} onClick={() => onDelete(event)}>
          {t("event.delete")}
        </button>
      )}
      </div>
      {phone && (
        <footer className="sheet-footer">
          <p className="sheet-status" role="status">
            {status.kind === "saving" && t("generic.saving")}
            {status.kind === "error" && <span className="sheet-error">{status.message}</span>}
            {status.kind !== "saving" && status.kind !== "error" && (saved.current || status.kind === "saved") && (
              <>
                <Check size={14} aria-hidden="true" />
                {t("event.autosaved")}
              </>
            )}
          </p>
          <div className="sheet-actions">
            {event && (
              <div className="split" ref={split}>
                <button
                  type="button"
                  className={footerAction === "delete" || event.holding === "archive" ? "btn lg split-main dng-q" : "btn lg split-main"}
                  onClick={() => {
                    if (footerAction === "delete" || event.holding === "archive") onDelete(event);
                    else void archiveAndClose();
                  }}
                >
                  {footerAction === "delete" || event.holding === "archive" ? (
                    <Trash2 size={16} aria-hidden="true" />
                  ) : (
                    <Archive size={16} aria-hidden="true" />
                  )}
                  {footerAction === "delete" || event.holding === "archive" ? t("event.deleteShort") : t("area.archive")}
                </button>
                {event.holding !== "archive" && (
                  <button
                    type="button"
                    className="btn lg split-more"
                    aria-label={t("event.moreActions")}
                    aria-expanded={menuOpen}
                    aria-controls="split-menu"
                    onClick={() => setMenuOpen(!menuOpen)}
                  >
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                )}
                {menuOpen && (
                  <ul className="split-menu" id="split-menu">
                    {(["archive", "delete"] as const).map((action) => (
                      <li key={action}>
                        <button
                          type="button"
                          aria-pressed={footerAction === action}
                          className={action === "delete" ? "danger" : undefined}
                          onClick={() => {
                            setFooterAction(action);
                            setMenuOpen(false);
                          }}
                        >
                          {footerAction === action ? <Check size={16} aria-hidden="true" /> : <span className="check-space" />}
                          <span>
                            <strong>{action === "delete" ? t("event.deleteShort") : t("area.archive")}</strong>
                            <small>{action === "delete" ? t("event.deleteHint") : t("event.archiveHint")}</small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <button type="button" className="btn lg pri ok" onClick={() => void finish()}>
              {t("event.ok")}
            </button>
          </div>
        </footer>
      )}
    </aside>
    </>
  );
}
