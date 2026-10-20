import { DragDropProvider } from "@dnd-kit/react";
import { Accessibility } from "@dnd-kit/dom";
import {
  adjacentPairs,
  allEvents,
  axisRange,
  DEFAULT_START_MINUTE,
  isHoldingArea,
  minuteAtOffset,
  moveBy,
  moveEvent,
  planDayDeletion,
  pxToMinutes,
  type CreateLegInput,
  type Day,
  type DayDeletionPlan,
  type Event,
  type HoldingArea,
  type Leg,
  type TravelMode,
  type Todo,
  type Trip,
} from "@travel-planner/shared";
import { ChevronLeft, ChevronRight, CalendarDays, CircleHelp, Map as MapIcon, Plus, Settings, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { deleteDay, insertDay, reorderDays, restoreDay } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { eventConflicts, hoursPlaceIds, useOpeningHours } from "./openingHours";
import { dayLabel, formatTripRange, tripStartDate, weekdayKey } from "./tripDates";
import { accessibility, DayTimeline, HourLabels, PX_PER_HOUR, sensors, type EventTimes } from "./DayTimeline";
import { endGesture } from "./gesture";
import { HoldingAreas } from "./HoldingAreas";
import { MapView } from "./MapView";
import { LegPopover } from "./LegPopover";
import { LodgingBanners, staysOf } from "./LodgingBanners";
import { TodosPanel } from "./TodosPanel";
import { useIsPhone } from "./phone";
import { keyOf, tip } from "./shortcuts";
import { usePreferences, useT } from "./preferences";

// What a move changes: the time, and/or the place (a Day id in `dayId`, or a holding area).
export type EventMove = Partial<Pick<Event, "startMinute" | "durationMinutes" | "dayId" | "holding">>;

type Props = {
  trip: Trip;
  // Opens Trip settings (the start date).
  onOpenSettings: () => void;
  onDaysChange: (tripId: string, days: Day[], backlog?: Event[]) => void;
  selectedEventId?: string;
  // A new Event being set up in the panel.
  draft?: { dayId: string; startMinute: number; durationMinutes: number; kind?: Event["kind"] };
  onSelectEvent: (eventId: string) => void;
  onCreateAt: (dayId: string, startMinute: number) => void;
  onAddToBacklog: () => void;
  onMove: (eventId: string, move: EventMove) => void;
  onCreateLeg: (input: CreateLegInput) => Promise<Leg>;
  onChangeLegMode: (leg: Leg, mode: TravelMode) => Promise<void>;
  onDeleteLeg: (leg: Leg) => Promise<void>;
  // The page shows one toast at a time; a new one replaces the old.
  onToast: (toast: Toasted | undefined) => void;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onShowShortcuts: () => void;
  // Shown at the bottom of the left column (the language and theme switches).
  footer?: ReactNode;
  onAddTodo: (text: string, eventId: string | null) => Promise<void>;
  onToggleTodo: (todo: Todo) => void;
  onDeleteTodo: (todo: Todo) => void;
};

export type Toasted = { id: number; message: string; undo?: () => void };

// Where the pointer is, as a drop target: a Day's axis (its id) or a holding area. The Event being
// dragged is skipped, as it is under the pointer itself; beside an axis (above, below) the Day's
// column still counts, so a drag past the end of the axis lands at its edge.
// Only targets inside this Trip (`root`) count, as the page shows several Trips.
function dropTargetAt(root: HTMLElement, x: number, y: number, draggedId: string): string | undefined {
  for (const element of document.elementsFromPoint(x, y)) {
    if (element.closest<HTMLElement>("[data-event-id]")?.dataset.eventId === draggedId) continue;
    const target = element.closest<HTMLElement>("[data-drop]");
    if (target && root.contains(target)) return target.dataset.drop;
  }
  for (const timeline of root.querySelectorAll<HTMLElement>(".day-timeline[data-drop]")) {
    const box = timeline.getBoundingClientRect();
    if (x >= box.left && x <= box.right) return timeline.dataset.drop;
  }
  return undefined;
}

export function TripCard({ trip, onOpenSettings, onDaysChange, selectedEventId, draft, onSelectEvent, onCreateAt, onAddToBacklog, onMove, onCreateLeg, onChangeLegMode, onDeleteLeg, onToast, notesOpen, onToggleNotes, onShowShortcuts, footer, onAddTodo, onToggleTodo, onDeleteTodo }: Props) {
  const t = useT();
  const { language } = usePreferences();
  const root = useRef<HTMLElement>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // The Day waiting for the user to confirm its deletion.
  const [pendingDelete, setPendingDelete] = useState<{ day: Day; plan: DayDeletionPlan } | undefined>();
  const setToast = onToast;
  // The area or Day a dragged Event is over.
  const [dropTarget, setDropTarget] = useState<string | undefined>();

  // Runs one Day change at a time and replaces the Trip's Days with the server's answer.
  async function changeDays(action: () => Promise<Day[]>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    // The Days are about to change, so the last deletion can no longer be undone safely.
    setToast(undefined);
    try {
      onDaysChange(trip.id, await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("generic.error"));
    } finally {
      setBusy(false);
    }
  }

  // An empty Day goes at once; one with Events asks first. Either way the toast offers Undo.
  function requestDelete(day: Day) {
    const plan = planDayDeletion(trip.days, day.id);
    if (plan.moved.length > 0) setPendingDelete({ day, plan });
    else void performDelete(day, plan);
  }

  async function performDelete(day: Day, plan: DayDeletionPlan) {
    if (busy) return;
    setPendingDelete(undefined);
    setToast(undefined);
    setBusy(true);
    setError(undefined);
    // What undo has to put back: the moved Events, and the stays that lost a night.
    const placements = [
      ...plan.moved.map((e) => ({ eventId: e.id, dayId: day.id, nights: e.nights })),
      ...plan.stays.map(({ event, before }) => ({ eventId: event.id, dayId: event.dayId!, nights: before.nights })),
    ];
    try {
      const result = await deleteDay(trip.id, day.id);
      onDaysChange(trip.id, result.days, result.backlog);
      setToast({
        id: Date.now(),
        message:
          plan.moved.length > 0
            ? t("day.deletedMoved", { n: day.position, events: t("count.event", { count: plan.moved.length }) })
            : t("day.deleted", { n: day.position }),
        undo: () => undoDelete(day, placements),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("generic.error"));
    } finally {
      setBusy(false);
    }
  }

  async function undoDelete(day: Day, placements: { eventId: string; dayId: string; nights: number | null }[]) {
    setToast(undefined);
    setBusy(true);
    setError(undefined);
    try {
      const result = await restoreDay(trip.id, { dayId: day.id, position: day.position, placements });
      onDaysChange(trip.id, result.days, result.backlog);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("day.undoFailed"));
    } finally {
      setBusy(false);
    }
  }

  // The Leg popover: the Events it is about and the element it points at. The Leg itself is read
  // from the Trip, so the popover shows the latest answer and goes when the Leg does.
  const [legUi, setLegUi] = useState<{ fromId: string; toId: string; anchor: HTMLElement } | undefined>();
  const legFrom = legUi && allEvents(trip).find((e) => e.id === legUi.fromId);
  const legTo = legUi && allEvents(trip).find((e) => e.id === legUi.toId);
  const legShown = legUi && trip.legs.find((l) => l.fromEventId === legUi.fromId && l.toEventId === legUi.toId);
  const closeLeg = useCallback(() => setLegUi(undefined), []);
  const legDay = legFrom && trip.days.find((d) => d.id === legFrom.dayId);
  const legLost =
    legUi &&
    (!legFrom ||
      !legTo ||
      !legDay ||
      !adjacentPairs(legDay.events.filter((e) => e.kind !== "lodging")).some(([a, b]) => a.id === legFrom.id && b.id === legTo.id));
  useEffect(() => {
    if (legLost) closeLeg();
  }, [legLost, closeLeg]);

  const phone = useIsPhone();
  // The time-axis view is where Events are edited; the Map View only shows them (PRD §6).
  const [view, setView] = useState<"schedule" | "map">("schedule");
  // Phone: one Day at a time, and one of the drawers (Backlog, Archive, Todos) open at most.
  const [dayId, setDayId] = useState(trip.days[0]?.id);
  const [drawer, setDrawer] = useState<"backlog" | "archive" | "todos" | undefined>();
  const shownDay = trip.days.find((d) => d.id === dayId) ?? trip.days[0];
  const selectedDayId = trip.days.find((d) => d.events.some((e) => e.id === selectedEventId))?.id;
  // Selecting an Event (from the Todos, say), or setting up a new one, brings its Day into view.
  const focusDayId = selectedDayId ?? (draft && trip.days.some((d) => d.id === draft.dayId) ? draft.dayId : undefined);
  useEffect(() => {
    if (focusDayId) setDayId(focusDayId);
  }, [focusDayId]);
  // Esc closes the open drawer; marked handled so the page's own Esc (clear the selection) stays out.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setDrawer(undefined);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawer]);
  const selectFromDrawer = (eventId: string) => {
    setDrawer(undefined);
    onSelectEvent(eventId);
  };
  const dayIds = trip.days.map((d) => d.id);
  const lastPosition = trip.days.length;
  // One range for every Day, so the Days line up side by side.
  // A stay is drawn as a banner above the axis, not on it.
  const onAxis = (day: Day) => day.events.filter((e) => e.kind !== "lodging");
  const range = axisRange(trip.days.flatMap(onAxis));
  const stays = staysOf(trip.days);
  const events = allEvents(trip);
  // Opening hours of the Events that have them on, for the warning on their cards.
  const startDate = tripStartDate(trip);
  const { hours: openingHours } = useOpeningHours(hoursPlaceIds(trip.days.flatMap(onAxis)));

  function insertButton(position: number) {
    return (
      <button
        type="button"
        className="ib insert-day"
        disabled={busy}
        aria-label={t("day.insert", { n: position })}
        title={t("day.insert", { n: position })}
        onClick={() => changeDays(() => insertDay(trip.id, position))}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    );
  }

  // Where a dropped Event goes. Within a Day it moves by how far it was dragged; from a holding
  // area onto a Day it starts where the pointer is.
  function drop(event: Event, target: string, pointerY: number, draggedPx: number) {
    if (isHoldingArea(target)) {
      if (event.holding !== target) onMove(event.id, { holding: target });
      return;
    }
    if (event.dayId) {
      const { startMinute } = moveEvent(event, pxToMinutes(draggedPx, PX_PER_HOUR), range);
      if (target !== event.dayId || startMinute !== event.startMinute) onMove(event.id, { dayId: target, startMinute });
      return;
    }
    const top = root.current?.querySelector<HTMLElement>(`.day-timeline[data-drop="${target}"]`)?.getBoundingClientRect().top ?? 0;
    onMove(event.id, { dayId: target, startMinute: minuteAtOffset(pointerY - top, range, PX_PER_HOUR) });
  }

  // Grid: hour labels, then for each Day a narrow column for its Insert button and a Day column.
  const shownDays = phone && shownDay ? [shownDay] : trip.days;
  const columns = phone ? "auto minmax(0, 1fr)" : `auto ${trip.days.map(() => "auto minmax(14rem, 1fr)").join(" ")} auto`;
  const deleting = pendingDelete;

  return (
    <article ref={root} className="workspace">
      <div className="topbar">
        <span className="logo" aria-hidden="true">
          <MapIcon size={18} />
        </span>
        <h2>{trip.title}</h2>
        {!phone && (
          <span className="trip-dates">
            {startDate && `${formatTripRange(startDate, trip.days.length, language)} · `}
            {t("trip.days", { count: trip.days.length })}
          </span>
        )}
        <button type="button" className="ib" title={t("trip.settings")} aria-label={t("trip.settings")} onClick={onOpenSettings}>
          <Settings size={16} aria-hidden="true" />
        </button>
        <div className="view-switch" role="group" aria-label={t("map.switch")}>
          <button type="button" aria-pressed={view === "schedule"} onClick={() => setView("schedule")}>
            <CalendarDays size={15} aria-hidden="true" />
            {t("map.schedule")}
          </button>
          <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}>
            <MapIcon size={15} aria-hidden="true" />
            {t("map.map")}
          </button>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" aria-pressed={notesOpen} title={tip(t("notes.title"), "notes")} onClick={onToggleNotes}>
          {t("notes.title")} <span className="count">{trip.notes.length}</span>
          <kbd className="kbd" aria-hidden="true">
            {keyOf("notes")}
          </kbd>
        </button>
        <button type="button" className="ib" title={tip(t("shortcuts.title"), "help")} aria-label={t("shortcuts.title")} onClick={onShowShortcuts}>
          <CircleHelp size={16} aria-hidden="true" />
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {phone && view === "schedule" && (
        <nav className="day-tabs" aria-label={t("day.tabs")}>
          {trip.days.map((day) => (
            <button
              key={day.id}
              type="button"
              className={day.id === shownDay?.id ? "day-tab on" : "day-tab"}
              aria-pressed={day.id === shownDay?.id}
              onClick={() => setDayId(day.id)}
            >
              {t("day.title", { n: day.position })}
              {startDate && (
                <>
                  {" "}
                  <small>{dayLabel(startDate, day.position).short}</small>
                </>
              )}
            </button>
          ))}
          <button
            type="button"
            className="day-tab add"
            disabled={busy}
            aria-label={t("day.add")}
            title={t("day.add")}
            onClick={() =>
              changeDays(async () => {
                const days = await insertDay(trip.id, lastPosition + 1);
                setDayId(days[days.length - 1]?.id);
                return days;
              })
            }
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </nav>
      )}
      {view === "map" ? (
        <MapView trip={trip} selectedEventId={selectedEventId} onSelectEvent={onSelectEvent} />
      ) : (
      <DragDropProvider
        sensors={sensors}
        plugins={(defaults) => [...defaults.filter((p) => p !== Accessibility), accessibility(events, t)]}
        onDragMove={({ operation }) => {
          const pointer = operation.position.current;
          setDropTarget(operation.source ? dropTargetAt(root.current!, pointer.x, pointer.y, String(operation.source.id)) : undefined);
        }}
        onDragEnd={({ operation, canceled }) => {
          endGesture();
          setDropTarget(undefined);
          const event = events.find((e) => e.id === operation.source?.id);
          if (canceled || !event) return;
          const pointer = operation.position.current;
          const target = dropTargetAt(root.current!, pointer.x, pointer.y, event.id);
          if (target) drop(event, target, pointer.y, operation.transform.y);
        }}
      >
        <div className="trip-layout">
          {(!phone || drawer === "backlog" || drawer === "archive") && (
          <HoldingAreas
            id={phone ? `drawer-${trip.id}` : undefined}
            only={phone ? (drawer as "backlog" | "archive") : undefined}
            backlog={trip.backlog}
            archive={trip.archive}
            selectedEventId={selectedEventId}
            dropTarget={dropTarget}
            onSelectEvent={phone ? selectFromDrawer : onSelectEvent}
            onAddToBacklog={() => {
              setDrawer(undefined);
              onAddToBacklog();
            }}
            onMoveTo={(eventId, area: HoldingArea) => onMove(eventId, { holding: area })}
            footer={phone ? undefined : footer}
          />
          )}
          <div className="days-grid" style={{ gridTemplateColumns: columns }}>
            <div className="axis-cell" style={{ gridColumn: 1, gridRow: 3 }}>
              <HourLabels range={range} />
            </div>
            {shownDays.map((day, index) => {
              const insertColumn = 2 + index * 2;
              const dayColumn = phone ? 2 : insertColumn + 1;
              return [
                !phone && (
                  <div key={`insert-${day.id}`} style={{ gridColumn: insertColumn, gridRow: 1 }}>
                    {insertButton(day.position)}
                  </div>
                ),
                <section
                  key={`head-${day.id}`}
                  className="day-head"
                  aria-label={t("day.title", { n: day.position })}
                  style={{ gridColumn: dayColumn, gridRow: 1 }}
                >
                  <h3>
                    {t("day.title", { n: day.position })}
                    {startDate && !phone && (
                      <>
                        {" "}
                        <small>
                        {dayLabel(startDate, day.position).short}・{t(weekdayKey(dayLabel(startDate, day.position).weekday))}
                        </small>
                      </>
                    )}
                  </h3>
                  <div>
                    <button
                      type="button"
                      className="ib"
                      aria-label={t("day.earlier")}
                      title={t("day.earlier")}
                      disabled={busy || day.position === 1}
                      onClick={() => changeDays(() => reorderDays(trip.id, moveBy(dayIds, day.id, -1)))}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="ib"
                      aria-label={t("day.later")}
                      title={t("day.later")}
                      disabled={busy || day.position === lastPosition}
                      onClick={() => changeDays(() => reorderDays(trip.id, moveBy(dayIds, day.id, 1)))}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="ib"
                      aria-label={t("day.delete")}
                      title={t("day.delete")}
                      disabled={busy || lastPosition === 1}
                      onClick={() => requestDelete(day)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="ib"
                    disabled={busy}
                    aria-label={t("day.addEvent")}
                    title={tip(t("day.addEvent"), "new-event")}
                    onClick={() => onCreateAt(day.id, DEFAULT_START_MINUTE)}
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </section>,
                <div key={`banners-${day.id}`} style={{ gridColumn: dayColumn, gridRow: 2 }}>
                  <LodgingBanners
                    position={day.position}
                    stays={stays}
                    selectedEventId={selectedEventId}
                    onSelectEvent={onSelectEvent}
                  />
                </div>,
                <div key={`axis-${day.id}`} style={{ gridColumn: dayColumn, gridRow: 3 }}>
                  <DayTimeline
                    dayId={day.id}
                    events={onAxis(day)}
                    range={range}
                    selectedEventId={selectedEventId}
                    dropTarget={dropTarget === day.id}
                    // A Lodging is never drawn on the axis, so its draft has no placeholder there.
                    draft={draft?.dayId === day.id && draft.kind !== "lodging" ? draft : undefined}
                    onSelectEvent={onSelectEvent}
                    onChangeTimes={(eventId: string, times: EventTimes) => onMove(eventId, times)}
                    onCreateAt={(startMinute) => onCreateAt(day.id, startMinute)}
                    legs={trip.legs.filter((l) => l.dayId === day.id)}
                    onOpenLeg={(target, anchor) => setLegUi({ fromId: target.from.id, toId: target.to.id, anchor })}
                    openingConflicts={new Set(onAxis(day).filter((e) => eventConflicts(e, day.position, startDate, openingHours)).map((e) => e.id))}
                  />
                </div>,
              ];
            })}
            {!phone && <div style={{ gridColumn: 2 + lastPosition * 2, gridRow: 1 }}>{insertButton(lastPosition + 1)}</div>}
          </div>
          {(!phone || drawer === "todos") && <TodosPanel id={phone ? `drawer-${trip.id}` : undefined} trip={trip} onSelectEvent={phone ? selectFromDrawer : onSelectEvent} onAdd={onAddTodo} onToggle={onToggleTodo} onDelete={onDeleteTodo} />}
        </div>
      </DragDropProvider>
      )}
      {view === "schedule" && legUi && legFrom && legTo && !legLost && (
        <LegPopover
          anchor={legUi.anchor}
          from={legFrom}
          to={legTo}
          leg={legShown}
          defaultMode={trip.travelMode}
          onCreate={(mode) => onCreateLeg({ fromEventId: legFrom.id, toEventId: legTo.id, mode })}
          onChangeMode={onChangeLegMode}
          onDelete={onDeleteLeg}
          onClose={closeLeg}
        />
      )}
      {phone && (
        <>
          {footer}
          {view === "schedule" && drawer && <div className="drawer-scrim" onClick={() => setDrawer(undefined)} />}
          {view === "schedule" && (
          <nav className="drawer-bar" aria-label={t("drawer.tabs")}>
            {(
              [
                ["backlog", t("area.backlog"), trip.backlog.length],
                ["archive", t("area.archive"), trip.archive.length],
                ["todos", t("todo.panel"), trip.todos.length],
              ] as const
            ).map(([id, label, count]) => (
              <button key={id} type="button" aria-expanded={drawer === id} aria-controls={`drawer-${trip.id}`} className={drawer === id ? "on" : undefined} onClick={() => setDrawer(drawer === id ? undefined : id)}>
                <span>
                  {label} <span className="count">{count}</span>
                </span>
              </button>
            ))}
          </nav>
          )}
        </>
      )}
      {deleting && (
        <ConfirmDialog
          title={t("day.deleteTitle", { n: deleting.day.position })}
          confirmLabel={t("day.delete")}
          onConfirm={() => performDelete(deleting.day, deleting.plan)}
          onCancel={() => setPendingDelete(undefined)}
        >
          <p>
            <strong>{t("count.event", { count: deleting.plan.moved.length })}</strong>
            {t("day.willMove")}
          </p>
          <ul>
            <li>{deleting.plan.moved.length === 1 ? t("day.todosKeptOne") : t("day.todosKeptMany")}</li>
            {trip.legs.some((l) => l.dayId === deleting.day.id) && (
              <li>{t("day.legsRemoved", { count: trip.legs.filter((l) => l.dayId === deleting.day.id).length })}</li>
            )}
            {deleting.day.position < lastPosition && (
              <li>
                {t("day.laterMoveUp", { from: deleting.day.position + 1, to: deleting.day.position })}
              </li>
            )}
            {deleting.plan.stays.map(({ event, before, after }) => (
              <li key={event.id}>
                {t("day.losesNight", { title: event.title, before: before.nights ?? 0, after: after.nights ?? 0 })}
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </article>
  );
}
