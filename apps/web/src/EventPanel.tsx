import {
  arrivalOf,
  durationBetween,
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
  showsOpeningHours,
  weekdayOf,
  type EventFields,
  type CreateEventInput,
  type Day,
  type Event,
  type Todo,
  type UpdateEventInput,
} from "@travel-planner/shared";
import { OpeningHoursSection } from "./OpeningHoursSection";
import { eventConflicts, useOpeningHours } from "./openingHours";
import { PlaceField } from "./PlaceField";
import { TodoList } from "./TodoList";
import { transportKey } from "./kinds";
import { useT } from "./preferences";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { useIsPhone } from "./phone";
import { KindDropdown } from "./KindDropdown";
import { Archive, Ellipsis, ListEnd, LogIn, Maximize2, Minimize2, RotateCcw, Trash2, X } from "lucide-react";

// The editor is large, so it is loaded when the first panel opens, not with the page.
const MarkdownEditor = lazy(() => import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })));

const EXPANDED_KEY = "travel-planner.event-panel-expanded";

function readExpanded() {
  try {
    return localStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveExpanded(expanded: boolean) {
  try {
    localStorage.setItem(EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    // Without storage the panel opens in its side form next time.
  }
}

type Status = { kind: "idle" } | { kind: "error"; message: string };

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

// What the page may ask of an open panel.
export type PanelApi = {
  // Whether the typed fields differ from what is saved (a new Event counts once something is typed).
  isDirty: () => boolean;
  // Saves them; false when the save failed or the fields are not valid.
  save: () => Promise<boolean>;
  // What is typed now, to keep it across a login redirect.
  fields: () => EventFields;
};

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
  // `force` closes without asking about unsaved changes (Cancel).
  onClose: (force?: boolean) => void;
  // Filled while the panel is open, so the page can ask whether to save before it leaves the panel.
  apiRef?: MutableRefObject<PanelApi | undefined>;
  // Only for a saved Event; a new one has neither Todos nor anything to delete yet.
  todos: Todo[];
  onAddTodo: (text: string, eventId: string) => Promise<void>;
  onToggleTodo: (todo: Todo) => void;
  onDeleteTodo: (todo: Todo) => void;
  onDelete: (event: Event) => void;
  // The Trip's start date ("YYYY-MM-DD"), which the opening-hours check needs.
  startDate?: string;
  // Opens Trip settings, where the start date is set.
  onOpenTripSettings: () => void;
  // Opening hours are turned on and off at once, not with Save. "none": Google has no hours for the place.
  onTurnOnOpeningHours: (eventId: string) => Promise<"on" | "none">;
  onRemoveOpeningHours: (eventId: string) => Promise<void>;
  // Selected from the keyboard: leave the focus where it is so the arrow keys keep working.
  quiet?: boolean;
  // The fields to start with instead of the Event's own: edits kept across a login redirect.
  restored?: EventFields;
  // Given while the session has ended: Save becomes "Log in to save". It logs in (in a popup, so
  // what is typed stays) and says whether the edits can be saved now.
  onLoginToSave?: (fields: EventFields) => Promise<boolean>;
};


// Edits one Event. Typed fields are saved by Save (or Enter), which also closes the panel; closing
// any other way with unsaved changes is first confirmed by the page. A new Event is created by saving
// it with a title. Remount it (key) for another Event.
export function EventPanel({
  days,
  event,
  newEvent,
  onCreate,
  onUpdate,
  onDraftChange,
  onClose,
  apiRef,
  todos,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  onDelete,
  startDate,
  onOpenTripSettings,
  onTurnOnOpeningHours,
  onRemoveOpeningHours,
  quiet,
  restored,
  onLoginToSave,
}: Props) {
  const t = useT();
  // The session ended: what is typed stays, but nothing else about the Event can be changed.
  const expired = Boolean(onLoginToSave);
  const { hours: placeHours, loading: hoursLoading } = useOpeningHours(event?.openingHoursOn && event.placeId ? [event.placeId] : []);
  const phone = useIsPhone();
  // The footer's ⋯ menu.
  const [menuOpen, setMenuOpen] = useState(false);
  // Desktop only: the panel as a centred dialog with two columns, kept per browser.
  const [expanded, setExpanded] = useState(readExpanded);
  const modal = expanded && !phone;
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
    openingHoursOn: false,
    ...newEvent!,
  };
  const original: EventFields = {
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
  };
  const [fields, setFields] = useState<EventFields>(restored ?? original);
  // Open from the start when there is something to show; after that only the user changes it.
  const [contactOpen] = useState(() => hasContact(restored ? { phone: restored.phone, email: restored.email, website: restored.website } : initial));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // The saved Event; for a new one this is set after it has been created.
  const saved = useRef<Event | undefined>(event);
  // Saves run one after another, each reading the latest fields when it starts.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The fields as last typed; change() is the only writer, so a queued save never sees stale text.
  const latest = useRef(fields);
  // Whether the last save failed.
  const failed = useRef(false);
  // The fields as the panel opened, to tell whether anything was typed into a new Event.
  const untouched = useRef(JSON.stringify(original));

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

  // Edits that came back from a login redirect: tell the page where a new Event now stands.
  useEffect(() => {
    if (restored) change({});
  }, []);

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
  }

  // Moving between a Day and a holding area keeps the same duration: a Transport event is shown by
  // its arrival on a Day and by its duration outside, so the hidden field is recalculated.
  function changePlace(place: string) {
    const current = latest.current;
    const start = parseTime(current.start) ?? saved.current?.startMinute;
    const duration = fieldsDuration(current) ?? saved.current?.durationMinutes;
    change({ dayId: place });
    if (start !== undefined && duration !== undefined) change(timeFields(start, duration));
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
    try {
      saved.current =
        plan.kind === "update"
          ? await onUpdate(current!.id, plan.patch)
          : await onCreate(plan.input, plan.dayId);
      // A move to the Archive the user declined leaves the Event where it was; show that.
      const result = saved.current;
      if (plan.kind === "update" && plan.patch.area && result && result.holding !== plan.patch.area) {
        // Declined, so nothing was saved: forget what was sent and show the place it still has.
        lastSent.current = undefined;
        change({ dayId: placeOf(result) });
        setStatus({ kind: "idle" });
        failed.current = true;
      }
    } catch (err) {
      failed.current = true;
      setStatus({ kind: "error", message: err instanceof Error ? err.message : t("generic.error") });
    }
  }

  // The ⋯ menu closes on a click outside it or on Escape (marked handled, so the
  // sheet's own Escape stays out).
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      // A tap on the scrim is handled by the scrim, which only closes the menu.
      const target = e.target as HTMLElement;
      if (!more.current?.contains(target) && !target.closest(".sheet-scrim, .panel-backdrop")) setMenuOpen(false);
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

  // Saves what is typed and reports whether it worked.
  async function saveNow() {
    // A new Event without a title has nothing to create: say so rather than drop what was typed.
    if (!saved.current && planEventSave(latest.current, undefined).kind === "wait" && JSON.stringify(latest.current) !== untouched.current) {
      failed.current = true;
      setStatus({ kind: "error", message: t("event.titleRequired") });
      return false;
    }
    commit();
    await queue.current;
    return !failed.current;
  }

  // Save: closes the panel once the changes are saved; a failed save keeps it open with the error.
  async function finish() {
    if (await saveNow()) onClose();
  }

  function isDirty() {
    const plan = planEventSave(latest.current, saved.current);
    if (plan.kind === "wait") return !saved.current && JSON.stringify(latest.current) !== untouched.current;
    return plan.kind === "update" || plan.kind === "create" || plan.kind === "error";
  }

  // Offered to the page on every render, so it never calls a stale closure.
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { isDirty, save: saveNow, fields: () => latest.current };
  });
  useEffect(
    () => () => {
      if (apiRef) apiRef.current = undefined;
    },
    [],
  );

  // Moves the Event to a holding area together with what was typed, then closes the panel.
  async function moveAndClose(area: "backlog" | "archive") {
    setMenuOpen(false);
    changePlace(area);
    commit();
    await queue.current;
    // A declined or failed move leaves the Event where it was.
    if (saved.current?.holding === area) onClose();
  }

  function toggleExpanded() {
    saveExpanded(!expanded);
    setExpanded(!expanded);
  }

  // With the session ended, saving starts with logging in; the edits stay as they are meanwhile.
  async function loginThenFinish() {
    if (onLoginToSave && (await onLoginToSave(latest.current))) await finish();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void (onLoginToSave ? loginThenFinish() : finish());
  }

  // The saved Event's Day, for the opening-hours check.
  const dayPosition = event?.dayId ? days.find((d) => d.id === event.dayId)?.position : undefined;
  const openingWeekday = startDate && dayPosition !== undefined ? weekdayOf(startDate, dayPosition) : undefined;
  const start = parseTime(fields.start);
  const shownDuration = fieldsDuration(fields);
  const held = isHoldingArea(fields.dayId);
  const arrivesNextDay =
    fields.kind === "transport" && !held &&
    start !== undefined && shownDuration !== undefined && arrivalOf(start, shownDuration).dayOffset > 0;

  const heldEvent = event?.holding;
  const dirty = isDirty();
  const menuItems = event ? (
    <>
      {!heldEvent && (
        <button type="button" role="menuitem" onClick={() => void moveAndClose("backlog")}>
          <ListEnd size={16} aria-hidden="true" />
          <span>
            {t("event.moveToBacklog")}
            {phone && <small>{t("event.moveToBacklogHint")}</small>}
          </span>
        </button>
      )}
      {heldEvent === "archive" && (
        <button type="button" role="menuitem" onClick={() => void moveAndClose("backlog")}>
          <RotateCcw size={16} aria-hidden="true" />
          <span>{t("event.restore")}</span>
        </button>
      )}
      {heldEvent !== "archive" && (
        <button type="button" role="menuitem" onClick={() => void moveAndClose("archive")}>
          <Archive size={16} aria-hidden="true" />
          <span>
            {t("area.archive")}
            {phone && <small>{t("event.archiveHint")}</small>}
          </span>
        </button>
      )}
      <hr />
      <button
        type="button"
        role="menuitem"
        className="danger"
        onClick={() => {
          setMenuOpen(false);
          onDelete(event);
        }}
      >
        <Trash2 size={16} aria-hidden="true" />
        <span>
          {t("event.deleteShort")}
          {phone && <small>{t("event.deleteHint")}</small>}
        </span>
      </button>
    </>
  ) : null;

  return (
    <>
    {/* Phone: the page behind the sheet cannot be used; tapping it closes the sheet, asking first about unsaved changes.
        Expanded: the same for the page behind the dialog. */}
    {phone && <div className="sheet-scrim" onClick={() => (menuOpen ? setMenuOpen(false) : onClose())} />}
    {modal && <div className="panel-backdrop" onClick={() => (menuOpen ? setMenuOpen(false) : onClose())} />}
    <aside
      className={`event-panel${modal ? " expanded" : ""}`}
      aria-label={t("event.panel")}
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? true : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      {phone && <div className="sheet-handle" aria-hidden="true" />}
      <div className="panel-head">
        <KindDropdown value={fields.kind} onChange={changeKind} large={phone} />
        {!phone && (
          <div className="panel-tools">
            <button type="button" className="btn sm" onClick={toggleExpanded}>
              {expanded ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
              {expanded ? t("event.collapse") : t("event.expand")}
            </button>
            <button type="button" className="icon-btn" onClick={() => onClose()} aria-label={t("generic.close")} title={t("generic.closeEsc")}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <div className="panel-body">
      <form onSubmit={handleSubmit} className="panel-form">
        <div className="pane-main">
        <label>
          {t("event.title")}
          <input
            autoFocus={!quiet || modal}
            data-field="title"
            value={fields.title}
            onChange={(e) => change({ title: e.target.value })}
          />
        </label>
        {phone && (
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
        )}
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
              />
            </label>
            <label>
              {t("event.checkIn")}
              <input
                type="time"
                value={fields.checkIn}
                onChange={(e) => change({ checkIn: e.target.value })}
              />
            </label>
            <label>
              {t("event.checkOut")}
              <input
                type="time"
                value={fields.checkOut}
                onChange={(e) => change({ checkOut: e.target.value })}
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
                />
              </label>
            )}
            {fields.kind === "transport" && (
              <label>
                {t("event.transportType")}
                <select
                  value={fields.transportLabel}
                  onChange={(e) => change({ transportLabel: e.target.value })}
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
              onChange={(placeId) => change({ placeId })}
            />
            <PlaceField
              label={t("place.to")}
              optional
              value={fields.destinationId}
              onChange={(destinationId) => change({ destinationId })}
            />
          </>
        ) : (
          <PlaceField
            label={t("place.location")}
            value={fields.placeId}
            onChange={(placeId) => change({ placeId })}
          />
        )}
        {showsBookingLink(fields.kind) && (
          <label>
            {t("event.bookingLink")}
            <input
              type="url"
              value={fields.bookingUrl}
              onChange={(e) => change({ bookingUrl: e.target.value })}
            />
            {isWebUrl(fields.bookingUrl.trim()) && (
              <a href={fields.bookingUrl.trim()} target="_blank" rel="noreferrer">
                {t("event.openLink")}
              </a>
            )}
          </label>
        )}
        <div className="field">
          <span>{t("event.description")}</span>
          <Suspense fallback={<div className="md-editor-loading">{t("event.loadingEditor")}</div>}>
            <MarkdownEditor
              label={t("event.description")}
              value={initial.description ?? ""}
              onChange={(description) => change({ description })}
            />
          </Suspense>
        </div>
        </div>
        <div className="pane-side">
        {showsContact(fields.kind) && (
          <details className="contact" open={contactOpen}>
            <summary>{t("event.contact")}</summary>
            <label>
              {t("event.phone")}
              <input type="tel" value={fields.phone} onChange={(e) => change({ phone: e.target.value })} />
            </label>
            <label>
              {t("event.email")}
              <input type="email" value={fields.email} onChange={(e) => change({ email: e.target.value })} />
            </label>
            <label>
              {t("event.website")}
              <input type="url" value={fields.website} onChange={(e) => change({ website: e.target.value })} />
              {isWebUrl(fields.website.trim()) && (
                <a href={fields.website.trim()} target="_blank" rel="noreferrer">
                  {t("event.openWebsite")}
                </a>
              )}
            </label>
          </details>
        )}
        {event && event.placeId && showsOpeningHours(fields.kind) && showsOpeningHours(event.kind) && fields.placeId === event.placeId && (
          <OpeningHoursSection
            on={event.openingHoursOn}
            hours={placeHours.get(event.placeId)}
            fetching={hoursLoading}
            weekday={openingWeekday}
            dated={startDate !== undefined}
            conflict={eventConflicts(event, dayPosition, startDate, placeHours)}
            onSetDate={onOpenTripSettings}
            onTurnOn={() => onTurnOnOpeningHours(event.id)}
            onRemove={() => onRemoveOpeningHours(event.id)}
          />
        )}
        </div>
        {/* Lets Enter submit from any field without a visible button. */}
        <button type="submit" hidden />
      </form>
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
            readOnly={expired}
          />
        </section>
      )}
      </div>
      {onLoginToSave && <p className="panel-notice">{t("event.keptOnScreen")}</p>}
      {status.kind === "error" && <p role="alert" className="panel-error">{status.message}</p>}
      <footer className="panel-foot">
        {event && (
          <div className="more" ref={more}>
            <button
              type="button"
              className="btn more-btn"
              disabled={expired}
              aria-label={t("event.moreActions")}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Ellipsis size={16} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className="more-menu" role="menu">
                {menuItems}
              </div>
            )}
          </div>
        )}
        <span className="spacer" />
        <button type="button" className={`btn${phone ? " lg" : " ghost"}`} onClick={() => onClose(true)}>
          {dirty || !event ? t("generic.cancel") : t("generic.close")}
        </button>
        <button type="button" className={`btn pri${phone ? " lg" : ""}`} onClick={() => void (onLoginToSave ? loginThenFinish() : finish())}>
          {onLoginToSave ? (
            <>
              <LogIn size={16} aria-hidden="true" />
              {t("event.loginToSave")}
            </>
          ) : event ? (
            t("event.save")
          ) : (
            t("event.addEvent")
          )}
        </button>
      </footer>
    </aside>
    </>
  );
}
