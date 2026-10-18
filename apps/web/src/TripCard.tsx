import { DragDropProvider } from "@dnd-kit/react";
import { Accessibility } from "@dnd-kit/dom";
import {
  allEvents,
  axisRange,
  DEFAULT_START_MINUTE,
  isHoldingArea,
  minuteAtOffset,
  moveBy,
  moveEvent,
  planDayDeletion,
  pxToMinutes,
  type Day,
  type DayDeletionPlan,
  type Event,
  type HoldingArea,
  type Todo,
  type Trip,
} from "@travel-planner/shared";
import { ChevronLeft, ChevronRight, CircleHelp, Map as MapIcon, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { deleteDay, insertDay, reorderDays, restoreDay } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { accessibility, DayTimeline, HourLabels, PX_PER_HOUR, sensors, type EventTimes } from "./DayTimeline";
import { endGesture } from "./gesture";
import { HoldingAreas } from "./HoldingAreas";
import { LodgingBanners, staysOf } from "./LodgingBanners";
import { TodosPanel } from "./TodosPanel";
import { keyOf, tip } from "./shortcuts";
import { useT } from "./preferences";

// What a move changes: the time, and/or the place (a Day id in `dayId`, or a holding area).
export type EventMove = Partial<Pick<Event, "startMinute" | "durationMinutes" | "dayId" | "holding">>;

type Props = {
  trip: Trip;
  onDaysChange: (tripId: string, days: Day[], backlog?: Event[]) => void;
  selectedEventId?: string;
  // A new Event being set up in the panel.
  draft?: { dayId: string; startMinute: number; durationMinutes: number; kind?: Event["kind"] };
  onSelectEvent: (eventId: string) => void;
  onCreateAt: (dayId: string, startMinute: number) => void;
  onAddToBacklog: () => void;
  onMove: (eventId: string, move: EventMove) => void;
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

export function TripCard({ trip, onDaysChange, selectedEventId, draft, onSelectEvent, onCreateAt, onAddToBacklog, onMove, onToast, notesOpen, onToggleNotes, onShowShortcuts, footer, onAddTodo, onToggleTodo, onDeleteTodo }: Props) {
  const t = useT();
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

  const dayIds = trip.days.map((d) => d.id);
  const lastPosition = trip.days.length;
  // One range for every Day, so the Days line up side by side.
  // A stay is drawn as a banner above the axis, not on it.
  const onAxis = (day: Day) => day.events.filter((e) => e.kind !== "lodging");
  const range = axisRange(trip.days.flatMap(onAxis));
  const stays = staysOf(trip.days);
  const events = allEvents(trip);

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
  const columns = `auto ${trip.days.map(() => "auto minmax(14rem, 1fr)").join(" ")} auto`;
  const deleting = pendingDelete;

  return (
    <article ref={root} className="workspace">
      <div className="topbar">
        <span className="logo" aria-hidden="true">
          <MapIcon size={18} />
        </span>
        <h2>{trip.title}</h2>
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
          <HoldingAreas
            backlog={trip.backlog}
            archive={trip.archive}
            selectedEventId={selectedEventId}
            dropTarget={dropTarget}
            onSelectEvent={onSelectEvent}
            onAddToBacklog={onAddToBacklog}
            onMoveTo={(eventId, area: HoldingArea) => onMove(eventId, { holding: area })}
            footer={footer}
          />
          <div className="days-grid" style={{ gridTemplateColumns: columns }}>
            <div className="axis-cell" style={{ gridColumn: 1, gridRow: 3 }}>
              <HourLabels range={range} />
            </div>
            {trip.days.map((day, index) => {
              const insertColumn = 2 + index * 2;
              const dayColumn = insertColumn + 1;
              return [
                <div key={`insert-${day.id}`} style={{ gridColumn: insertColumn, gridRow: 1 }}>
                  {insertButton(day.position)}
                </div>,
                <section
                  key={`head-${day.id}`}
                  className="day-head"
                  aria-label={t("day.title", { n: day.position })}
                  style={{ gridColumn: dayColumn, gridRow: 1 }}
                >
                  <h3>{t("day.title", { n: day.position })}</h3>
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
                  />
                </div>,
              ];
            })}
            <div style={{ gridColumn: 2 + lastPosition * 2, gridRow: 1 }}>{insertButton(lastPosition + 1)}</div>
          </div>
          <TodosPanel trip={trip} onSelectEvent={onSelectEvent} onAdd={onAddTodo} onToggle={onToggleTodo} onDelete={onDeleteTodo} />
        </div>
      </DragDropProvider>
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
