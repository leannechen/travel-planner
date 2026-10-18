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
  withShortcut,
} from "@travel-planner/shared";
import { useRef, useState } from "react";
import { deleteDay, insertDay, reorderDays, restoreDay } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { accessibility, DayTimeline, HourLabels, PX_PER_HOUR, sensors, type EventTimes } from "./DayTimeline";
import { endGesture } from "./gesture";
import { HoldingAreas } from "./HoldingAreas";
import { LodgingBanners, staysOf } from "./LodgingBanners";
import { TodosPanel } from "./TodosPanel";

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
  onAddTodo: (text: string, eventId: string | null) => Promise<void>;
  onToggleTodo: (todo: Todo) => void;
  onDeleteTodo: (todo: Todo) => void;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

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

export function TripCard({ trip, onDaysChange, selectedEventId, draft, onSelectEvent, onCreateAt, onAddToBacklog, onMove, onToast, notesOpen, onToggleNotes, onShowShortcuts, onAddTodo, onToggleTodo, onDeleteTodo }: Props) {
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
      setError(err instanceof Error ? err.message : "Something went wrong");
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
            ? `Day ${day.position} deleted · ${plural(plan.moved.length, "Event")} moved to the Backlog`
            : `Day ${day.position} deleted`,
        undo: () => undoDelete(day, placements),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
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
      setError(err instanceof Error ? err.message : "Could not undo the deletion");
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
      <button type="button" disabled={busy} onClick={() => changeDays(() => insertDay(trip.id, position))}>
        Insert Day {position}
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
    <article ref={root}>
      <div className="trip-head">
        <h2>{trip.title}</h2>
        <button type="button" aria-pressed={notesOpen} title={withShortcut("Notes", "notes")} onClick={onToggleNotes}>
          Notes <span className="count">{trip.notes.length}</span>
        </button>
        <button type="button" title={withShortcut("Keyboard shortcuts", "help")} aria-label="Keyboard shortcuts" onClick={onShowShortcuts}>
          ?
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <DragDropProvider
        sensors={sensors}
        plugins={(defaults) => [...defaults.filter((p) => p !== Accessibility), accessibility(events)]}
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
                  aria-label={`Day ${day.position}`}
                  style={{ gridColumn: dayColumn, gridRow: 1 }}
                >
                  <h3>Day {day.position}</h3>
                  <div>
                    <button
                      type="button"
                      disabled={busy || day.position === 1}
                      onClick={() => changeDays(() => reorderDays(trip.id, moveBy(dayIds, day.id, -1)))}
                    >
                      Move earlier
                    </button>
                    <button
                      type="button"
                      disabled={busy || day.position === lastPosition}
                      onClick={() => changeDays(() => reorderDays(trip.id, moveBy(dayIds, day.id, 1)))}
                    >
                      Move later
                    </button>
                    <button type="button" disabled={busy || lastPosition === 1} onClick={() => requestDelete(day)}>
                      Delete Day
                    </button>
                  </div>
                  <button type="button" disabled={busy} title={withShortcut("Add event", "new-event")} onClick={() => onCreateAt(day.id, DEFAULT_START_MINUTE)}>
                    Add event
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
          title={`Delete Day ${deleting.day.position}?`}
          confirmLabel="Delete Day"
          onConfirm={() => performDelete(deleting.day, deleting.plan)}
          onCancel={() => setPendingDelete(undefined)}
        >
          <p>
            <strong>{plural(deleting.plan.moved.length, "Event")}</strong> will move to the Backlog.
          </p>
          <ul>
            <li>{deleting.plan.moved.length === 1 ? "Its Todos are kept." : "Their Todos are kept."}</li>
            {deleting.day.position < lastPosition && (
              <li>
                Later Days move up: Day {deleting.day.position + 1} becomes Day {deleting.day.position}.
              </li>
            )}
            {deleting.plan.stays.map(({ event, before, after }) => (
              <li key={event.id}>
                {event.title} loses a night ({before.nights} to {after.nights}).
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </article>
  );
}
