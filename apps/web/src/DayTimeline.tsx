import { DragDropProvider, useDraggable } from "@dnd-kit/react";
import { Modifier, type DragOperation } from "@dnd-kit/abstract";
import { Accessibility, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { RestrictToElement } from "@dnd-kit/dom/modifiers";
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers";
import {
  formatMinute,
  layoutDay,
  minuteAtOffset,
  MINUTES_PER_DAY,
  moveEvent,
  pxToMinutes,
  resizeBottom,
  resizeTop,
  SNAP_MINUTES,
  type Event,
} from "@travel-planner/shared";
import { KindIcon } from "./kinds";
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";

export const PX_PER_HOUR = 64;
const SNAP_PX = (PX_PER_HOUR * SNAP_MINUTES) / 60;

type Range = { startMinute: number; endMinute: number };
export type EventTimes = { startMinute: number; durationMinutes: number };

// The real end, even when it is past midnight and the card is cut off there.
const formatEnd = (end: number) =>
  end > MINUTES_PER_DAY ? `${formatMinute(end - MINUTES_PER_DAY)} +1` : formatMinute(end);

const toPx = (minutes: number) => (minutes / 60) * PX_PER_HOUR;

function hourStarts(range: Range) {
  const hours: number[] = [];
  for (let m = range.startMinute; m < range.endMinute; m += 60) hours.push(m);
  return hours;
}

export function HourLabels({ range }: { range: Range }) {
  return (
    <div className="hour-labels" style={{ height: toPx(range.endMinute - range.startMinute) }} aria-hidden="true">
      {hourStarts(range).map((m) => (
        <span key={m} style={{ top: toPx(m - range.startMinute) }}>
          {formatMinute(m)}
        </span>
      ))}
    </div>
  );
}

type Props = {
  events: Event[];
  range: Range;
  selectedEventId?: string;
  // A new Event being set up in the panel; drawn as a dashed placeholder.
  draft?: { startMinute: number; durationMinutes: number };
  onSelectEvent: (eventId: string) => void;
  onCreateAt: (startMinute: number) => void;
  onChangeTimes: (eventId: string, times: EventTimes) => void;
};

// A drag starts after the pointer moves a few pixels, so a plain click still selects. The
// constraints are created for each press, as the library does by default.
const sensors = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 5 })],
  }),
];

// Snaps the vertical movement to the nearest grid step. (The library's SnapModifier rounds up, so
// a one-pixel wobble after the drag starts would move the Event a whole step.)
class RoundSnapY extends Modifier {
  apply({ transform }: DragOperation) {
    return { ...transform, y: Math.round(transform.y / SNAP_PX) * SNAP_PX };
  }
}

// Keyboard dragging is off, so screen reader users are pointed to the panel's Start field. The
// library's default texts promise keyboard dragging and read out the Event's id.
function accessibility(events: Event[]) {
  const title = (operation: DragOperation) =>
    events.find((e) => e.id === operation.source?.id)?.title ?? "event";
  return Accessibility.configure({
    screenReaderInstructions: {
      draggable:
        "Drag with the mouse to change the time. With the keyboard, select the event and use the Start and Duration fields in the edit panel.",
    },
    announcements: {
      dragstart: ({ operation }: { operation: DragOperation }) => `Picked up ${title(operation)}`,
      dragend: ({ operation }: { operation: DragOperation }) => `Dropped ${title(operation)}`,
    },
  });
}

// One Day's Events on the shared axis. Events running past midnight are cut off there.
// Dragging a card moves it up or down; the handles on the selected card resize it. Only the
// dragged Event changes; the others stay where they are.
export function DayTimeline({
  events,
  range,
  selectedEventId,
  draft,
  onSelectEvent,
  onCreateAt,
  onChangeTimes,
}: Props) {
  const placements = new Map(layoutDay(events).map((p) => [p.id, p]));
  const timelineRef = useRef<HTMLUListElement>(null);
  // The click that ends a drag or a resize must not create an Event or select one: dragging
  // never opens the edit panel.
  const swallowClick = useRef(false);
  const [resizing, setResizing] = useState<({ id: string } & EventTimes) | undefined>();

  function finishGesture() {
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 50);
  }

  // Only clicks on the empty axis create; clicks on an Event card select it instead.
  // Keyboard users create through the Day's "Add event" button.
  function handleAxisClick(e: MouseEvent<HTMLUListElement>) {
    if (swallowClick.current) return;
    if ((e.target as HTMLElement).closest(".event-card, .new-event")) return;
    const top = e.currentTarget.getBoundingClientRect().top;
    onCreateAt(minuteAtOffset(e.clientY - top, range, PX_PER_HOUR));
  }

  function startResize(event: Event, edge: "top" | "bottom", e: PointerEvent<HTMLElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const original = { startMinute: event.startMinute, durationMinutes: event.durationMinutes };
    const compute = (clientY: number) => {
      const delta = pxToMinutes(clientY - startY, PX_PER_HOUR);
      return (edge === "top" ? resizeTop : resizeBottom)(original, delta, range);
    };
    const target = e.currentTarget;

    const onMove = (m: globalThis.PointerEvent) => setResizing({ id: event.id, ...compute(m.clientY) });
    const stop = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onCancel);
      target.removeEventListener("lostpointercapture", onCancel);
    };
    const onUp = (u: globalThis.PointerEvent) => {
      stop();
      const result = compute(u.clientY);
      setResizing(undefined);
      finishGesture();
      if (result.startMinute !== original.startMinute || result.durationMinutes !== original.durationMinutes) {
        onChangeTimes(event.id, result);
      }
    };
    const onCancel = () => {
      stop();
      setResizing(undefined);
      finishGesture();
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onCancel);
    // The handle can be removed mid-gesture (the selection changed); then no pointerup arrives.
    target.addEventListener("lostpointercapture", onCancel);
  }

  return (
    <DragDropProvider
      sensors={sensors}
      plugins={(defaults) => [...defaults.filter((p) => p !== Accessibility), accessibility(events)]}
      onDragEnd={(drag) => {
        finishGesture();
        const id = drag.operation.source?.id;
        const event = events.find((e) => e.id === id);
        if (drag.canceled || !event) return;
        const delta = pxToMinutes(drag.operation.transform.y, PX_PER_HOUR);
        const result = moveEvent(event, delta, range);
        if (result.startMinute !== event.startMinute) onChangeTimes(event.id, result);
      }}
    >
      <ul
        ref={timelineRef}
        className="day-timeline"
        style={{ height: toPx(range.endMinute - range.startMinute) }}
        onClick={handleAxisClick}
      >
        {hourStarts(range).map((m) => (
          <li key={m} className="hour-line" style={{ top: toPx(m - range.startMinute) }} aria-hidden="true" />
        ))}
        {events.map((event) => {
          const placement = placements.get(event.id)!;
          const times = resizing?.id === event.id ? resizing : event;
          return (
            <EventCard
              key={event.id}
              event={event}
              times={times}
              range={range}
              column={placement.column}
              columnCount={placement.columnCount}
              selected={event.id === selectedEventId}
              resizing={resizing?.id === event.id}
              timelineRef={timelineRef}
              onSelect={() => {
                if (!swallowClick.current) onSelectEvent(event.id);
              }}
              onResizeStart={(edge, e) => startResize(event, edge, e)}
            />
          );
        })}
        {draft && (
          <li
            className="new-event"
            style={{
              top: toPx(draft.startMinute - range.startMinute),
              height: toPx(Math.min(draft.durationMinutes, MINUTES_PER_DAY - draft.startMinute)) - 2,
            }}
          >
            New Event · {formatMinute(draft.startMinute)}
          </li>
        )}
      </ul>
    </DragDropProvider>
  );
}

type CardProps = {
  event: Event;
  times: EventTimes;
  range: Range;
  column: number;
  columnCount: number;
  selected: boolean;
  resizing: boolean;
  timelineRef: React.RefObject<HTMLUListElement | null>;
  onSelect: () => void;
  onResizeStart: (edge: "top" | "bottom", e: PointerEvent<HTMLElement>) => void;
};

function EventCard({
  event,
  times,
  range,
  column,
  columnCount,
  selected,
  resizing,
  timelineRef,
  onSelect,
  onResizeStart,
}: CardProps) {
  // Only the card's button starts a drag, so the resize handles never do.
  // Created once per card, so the library does not rebuild them on every render during a drag.
  // Snap first, keep inside the axis last.
  const modifiers = useMemo(
    () => [
      RestrictToVerticalAxis,
      RoundSnapY,
      RestrictToElement.configure({ element: () => timelineRef.current }),
    ],
    [timelineRef],
  );
  const { ref, handleRef, isDragging } = useDraggable({ id: event.id, modifiers });

  const realEnd = times.startMinute + times.durationMinutes;
  const drawnHeight = toPx(Math.min(realEnd, MINUTES_PER_DAY) - times.startMinute);
  const classes = ["event-card", `kind-${event.kind}`, selected && "selected", isDragging && "dragging"].filter(Boolean).join(" ");

  return (
    <li
      ref={ref}
      className={classes}
      style={{
        top: toPx(times.startMinute - range.startMinute),
        height: drawnHeight - 2,
        left: `${(column / columnCount) * 100}%`,
        width: `${100 / columnCount}%`,
      }}
    >
      <button type="button" ref={handleRef} onClick={onSelect}>
        <strong>
          <KindIcon kind={event.kind} transportLabel={event.transportLabel} />
          {event.title}
        </strong>
        <span>
          {formatMinute(times.startMinute)} – {formatEnd(realEnd)}
        </span>
      </button>
      {(selected || resizing) && (
        <>
          <div className="resize-handle top" onPointerDown={(e) => onResizeStart("top", e)} />
          <div className="resize-handle bottom" onPointerDown={(e) => onResizeStart("bottom", e)} />
        </>
      )}
    </li>
  );
}
