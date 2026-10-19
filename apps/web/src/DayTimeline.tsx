import { useDraggable } from "@dnd-kit/react";
import { Modifier, type DragOperation } from "@dnd-kit/abstract";
import { Accessibility, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import {
  adjacentPairs,
  formatMinute,
  legEndpoints,
  legGap,
  legTooShort,
  layoutDay,
  minuteAtOffset,
  MINUTES_PER_DAY,
  pxToMinutes,
  resizeBottom,
  resizeTop,
  SNAP_MINUTES,
  type Event,
  type Leg,
} from "@travel-planner/shared";
import { KindIcon } from "./kinds";
import { formatDuration, MODE_ICONS, modeKey } from "./legFormat";
import { useT } from "./preferences";
import type { Params } from "./i18n";
import type { MessageKey } from "./messages";
import { endGesture, gestureJustEnded } from "./gesture";
import { TriangleAlert } from "lucide-react";
import { useMemo, useState, type MouseEvent, type PointerEvent } from "react";

export const PX_PER_HOUR = 64;
export const SNAP_PX = (PX_PER_HOUR * SNAP_MINUTES) / 60;

export type Range = { startMinute: number; endMinute: number };
export type EventTimes = { startMinute: number; durationMinutes: number };

// The real end, even when it is past midnight and the card is cut off there.
const formatEnd = (end: number) =>
  end >= MINUTES_PER_DAY ? `${formatMinute(end - MINUTES_PER_DAY)} +1` : formatMinute(end);

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
  dayId: string;
  events: Event[];
  range: Range;
  selectedEventId?: string;
  // A new Event being set up in the panel; drawn as a dashed placeholder.
  draft?: { startMinute: number; durationMinutes: number };
  // A dragged Event is over this Day.
  dropTarget?: boolean;
  onSelectEvent: (eventId: string) => void;
  onCreateAt: (startMinute: number) => void;
  onChangeTimes: (eventId: string, times: EventTimes) => void;
  // The Legs of this Day, and what opens when one (or the slot for a new one) is clicked.
  legs: Leg[];
  onOpenLeg: (target: LegTarget, anchor: HTMLElement) => void;
};

export type LegTarget = { from: Event; to: Event; leg?: Leg };

// A drag starts after the pointer moves a few pixels, so a plain click still selects. The
// constraints are created for each press, as the library does by default.
export const sensors = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 5 })],
  }),
];

// Snaps the vertical movement to the nearest grid step. (The library's SnapModifier rounds up, so
// a one-pixel wobble after the drag starts would move the Event a whole step.)
export class RoundSnapY extends Modifier {
  apply({ transform }: DragOperation) {
    return { ...transform, y: Math.round(transform.y / SNAP_PX) * SNAP_PX };
  }
}

// Keyboard dragging is off, so screen reader users are pointed to the panel's fields. The
// library's default texts promise keyboard dragging and read out the Event's id.
export function accessibility(events: Event[], t: (key: MessageKey, params?: Params) => string) {
  const title = (operation: DragOperation) =>
    events.find((e) => e.id === operation.source?.id)?.title ?? t("drag.event");
  return Accessibility.configure({
    screenReaderInstructions: {
      draggable: t("drag.instructions"),
    },
    announcements: {
      dragstart: ({ operation }: { operation: DragOperation }) => t("drag.picked", { title: title(operation) }),
      dragend: ({ operation }: { operation: DragOperation }) => t("drag.dropped", { title: title(operation) }),
    },
  });
}

// One Day's Events on the shared axis. Events running past midnight are cut off there.
// Dragging a card moves it (the drag is handled by the Trip, which also knows the other areas);
// the handles on the selected card resize it. Only the dragged Event changes; the others stay
// where they are.
export function DayTimeline({
  dayId,
  events,
  range,
  selectedEventId,
  draft,
  dropTarget,
  onSelectEvent,
  onCreateAt,
  onChangeTimes,
  legs,
  onOpenLeg,
}: Props) {
  const t = useT();
  const placements = new Map(layoutDay(events).map((p) => [p.id, p]));
  const [resizing, setResizing] = useState<({ id: string } & EventTimes) | undefined>();

  const finishGesture = endGesture;

  // Only clicks on the empty axis create; clicks on an Event card select it instead.
  // Keyboard users create through the Day's "Add event" button.
  function handleAxisClick(e: MouseEvent<HTMLUListElement>) {
    if (gestureJustEnded()) return;
    if ((e.target as HTMLElement).closest(".event-card, .new-event, .leg-row")) return;
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
    <ul
      className={dropTarget ? "day-timeline drop-target" : "day-timeline"}
      data-drop={dayId}
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
            onSelect={() => {
              if (!gestureJustEnded()) onSelectEvent(event.id);
            }}
            onResizeStart={(edge, e) => startResize(event, edge, e)}
          />
        );
      })}
      {adjacentPairs(events).map(([from, to]) => (
        <LegRow
          key={`${from.id}>${to.id}`}
          from={from}
          to={to}
          leg={legs.find((l) => l.fromEventId === from.id && l.toEventId === to.id)}
          range={range}
          onOpen={onOpenLeg}
        />
      ))}
      {draft && (
        <li
          className="new-event"
          style={{
            top: toPx(draft.startMinute - range.startMinute),
            height: toPx(Math.min(draft.durationMinutes, MINUTES_PER_DAY - draft.startMinute)) - 2,
          }}
        >
          {t("timeline.newEvent", { time: formatMinute(draft.startMinute) })}
        </li>
      )}
    </ul>
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
  onSelect,
  onResizeStart,
}: CardProps) {
  // Only the card's button starts a drag, so the resize handles never do.
  // Created once per card, so the library does not rebuild them on every render during a drag.
  // The movement is free sideways (to reach other Days and the holding areas) and snapped
  // vertically; where the card lands is decided when it is dropped.
  const modifiers = useMemo(() => [RoundSnapY], []);
  const { ref, handleRef, isDragging } = useDraggable({ id: event.id, modifiers });

  const realEnd = times.startMinute + times.durationMinutes;
  const drawnHeight = toPx(Math.min(realEnd, MINUTES_PER_DAY) - times.startMinute);
  const classes = ["event-card", `kind-${event.kind}`, selected && "selected", isDragging && "dragging"].filter(Boolean).join(" ");

  return (
    <li
      ref={ref}
      className={classes}
      data-event-id={event.id}
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
          <span className="event-title">{event.title}</span>
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

type LegRowProps = { from: Event; to: Event; leg?: Leg; range: Range; onOpen: (target: LegTarget, anchor: HTMLElement) => void };

// The space between two adjacent Events: the Leg between them, or a slot to add one (ADR 0002).
// A slot needs a location on both Events; one that has lost its location keeps showing its Leg.
function LegRow({ from, to, leg, range, onOpen }: LegRowProps) {
  const t = useT();
  const top = toPx(from.startMinute + from.durationMinutes - range.startMinute);
  const bottom = toPx(to.startMinute - range.startMinute);
  const middle = (top + bottom) / 2;
  const { fromPlaceId, toPlaceId } = legEndpoints(from, to);
  if (middle > toPx(range.endMinute - range.startMinute)) return null;
  if (!leg && !(fromPlaceId && toPlaceId)) return null;

  const open = (e: MouseEvent<HTMLButtonElement>) => onOpen({ from, to, leg }, e.currentTarget);

  if (!leg) {
    return (
      <li className="leg-row" style={{ top: middle }}>
        <button type="button" className="leg-slot" aria-label={t("leg.addBetween", { from: from.title, to: to.title })} onClick={open}>
          + {t("leg.add")}
        </button>
      </li>
    );
  }

  const Icon = MODE_ICONS[leg.mode];
  const gap = legGap(from, to);
  const warning = legTooShort(leg, gap);
  const none = leg.durationMinutes === null;
  const duration = none ? t("leg.cantCalculate") : formatDuration(leg.durationMinutes!, t);
  return (
    <li className="leg-row" style={{ top: middle }}>
      <button
        type="button"
        className={warning || none ? "leg-pill warn" : "leg-pill"}
        aria-label={t("leg.pill", { mode: t(modeKey(leg.mode)), duration })}
        onClick={open}
      >
        {warning || none ? <TriangleAlert size={12} aria-hidden="true" /> : <Icon size={12} aria-hidden="true" />}
        {warning ? t("leg.pillShort", { duration, gap: formatDuration(Math.max(gap, 0), t) }) : duration}
      </button>
    </li>
  );
}
