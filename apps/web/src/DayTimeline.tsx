import { useDraggable } from "@dnd-kit/react";
import { Modifier, type DragOperation } from "@dnd-kit/abstract";
import { Accessibility, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import {
  adjacentPairs,
  DEFAULT_DURATION_MINUTES,
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
import { Plus, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent, type PointerEvent } from "react";

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
  // Events whose time may not fit their place's opening hours (PRD §3.5).
  openingConflicts?: ReadonlySet<string>;
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
  openingConflicts,
}: Props) {
  const t = useT();
  const placements = new Map(layoutDay(events).map((p) => [p.id, p]));
  const [resizing, setResizing] = useState<({ id: string } & EventTimes) | undefined>();
  // The slot whose buttons are shown by a tap (touch screens); a hover or focus shows them too.
  const [openSlot, setOpenSlot] = useState<string | undefined>();
  useEffect(() => {
    if (!openSlot) return;
    const dismiss = (e: globalThis.PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".slot-row.open")) setOpenSlot(undefined);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpenSlot(undefined);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [openSlot]);

  const finishGesture = endGesture;

  // Only clicks on the empty axis create; clicks on an Event card select it instead.
  // Keyboard users create through the Day's "Add event" button.
  function handleAxisClick(e: MouseEvent<HTMLUListElement>) {
    if (gestureJustEnded()) return;
    if ((e.target as HTMLElement).closest(".event-card, .new-event, .leg-row, .slot-actions")) return;
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
            openingConflict={openingConflicts?.has(event.id) ?? false}
            onSelect={() => {
              if (!gestureJustEnded()) onSelectEvent(event.id);
            }}
            onResizeStart={(edge, e) => startResize(event, edge, e)}
          />
        );
      })}
      {adjacentPairs(events).map(([from, to]) => {
        const leg = legs.find((l) => l.fromEventId === from.id && l.toEventId === to.id);
        const key = `${from.id}>${to.id}`;
        return leg ? (
          <LegRow key={key} from={from} to={to} leg={leg} range={range} onOpen={onOpenLeg} />
        ) : (
          <SlotRow
            key={key}
            id={key}
            from={from}
            to={to}
            startMinute={from.startMinute + from.durationMinutes}
            endMinute={to.startMinute}
            createAt={from.startMinute + from.durationMinutes}
            range={range}
            open={openSlot === key}
            onOpenChange={(open) => setOpenSlot(open ? key : undefined)}
            onCreateAt={onCreateAt}
            onOpenLeg={onOpenLeg}
          />
        );
      })}
      {edgeSlots(events, range).map((slot) => (
        <SlotRow
          key={slot.id}
          {...slot}
          range={range}
          open={openSlot === slot.id}
          onOpenChange={(open) => setOpenSlot(open ? slot.id : undefined)}
          onCreateAt={onCreateAt}
          onOpenLeg={onOpenLeg}
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
  openingConflict: boolean;
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
  openingConflict,
  onSelect,
  onResizeStart,
}: CardProps) {
  const t = useT();
  // Only the card's button starts a drag, so the resize handles never do.
  // Created once per card, so the library does not rebuild them on every render during a drag.
  // The movement is free sideways (to reach other Days and the holding areas) and snapped
  // vertically; where the card lands is decided when it is dropped.
  const modifiers = useMemo(() => [RoundSnapY], []);
  const { ref, handleRef, isDragging } = useDraggable({ id: event.id, modifiers });

  const realEnd = times.startMinute + times.durationMinutes;
  const drawnHeight = toPx(Math.min(realEnd, MINUTES_PER_DAY) - times.startMinute);
  const classes = ["event-card", `kind-${event.kind}`, selected && "selected", openingConflict && "warn", isDragging && "dragging"].filter(Boolean).join(" ");

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
        {openingConflict && (
          <span className="event-warning">
            <TriangleAlert size={12} aria-hidden="true" />
            {t("opening.conflict")}
          </span>
        )}
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

type LegRowProps = { from: Event; to: Event; leg: Leg; range: Range; onOpen: (target: LegTarget, anchor: HTMLElement) => void };

// The Leg between two adjacent Events, drawn as a pill on the middle of the space between them.
// A Leg stays when an Event loses its location, so it can still show it cannot be calculated.
function LegRow({ from, to, leg, range, onOpen }: LegRowProps) {
  const t = useT();
  const top = toPx(from.startMinute + from.durationMinutes - range.startMinute);
  const bottom = toPx(to.startMinute - range.startMinute);
  const middle = (top + bottom) / 2;
  if (middle > toPx(range.endMinute - range.startMinute)) return null;

  const open = (e: MouseEvent<HTMLButtonElement>) => onOpen({ from, to, leg }, e.currentTarget);

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

// How much empty time before the first Event or after the last one is offered as a slot.
const EDGE_SLOT_MINUTES = 120;

type Slot = {
  id: string;
  // The Events on each side; the slot before the first Event or after the last has one only.
  from?: Event;
  to?: Event;
  startMinute: number;
  endMinute: number;
  // Where "Add Event" starts the new Event; the end of the Event before, or for the stretch before
  // the first Event, an hour before it so the new one fits.
  createAt: number;
};

// The empty time before the first Event and after the last one (the Events are not sorted).
function edgeSlots(events: Event[], range: Range): Slot[] {
  if (events.length === 0) return [];
  const first = events.reduce((a, b) => (b.startMinute < a.startMinute ? b : a));
  const last = events.reduce((a, b) => (b.startMinute + b.durationMinutes > a.startMinute + a.durationMinutes ? b : a));
  const lastEnd = last.startMinute + last.durationMinutes;
  const slots: Slot[] = [];
  const before = Math.max(range.startMinute, first.startMinute - EDGE_SLOT_MINUTES);
  if (before < first.startMinute) slots.push({
      id: `<${first.id}`,
      to: first,
      startMinute: before,
      endMinute: first.startMinute,
      createAt: Math.max(before, first.startMinute - DEFAULT_DURATION_MINUTES),
    });
  const after = Math.min(range.endMinute, lastEnd + EDGE_SLOT_MINUTES);
  if (lastEnd < after) slots.push({ id: `${last.id}>`, from: last, startMinute: lastEnd, endMinute: after, createAt: lastEnd });
  return slots;
}

type SlotRowProps = Slot & {
  range: Range;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateAt: (startMinute: number) => void;
  onOpenLeg: (target: LegTarget, anchor: HTMLElement) => void;
};

// An empty stretch of the Day. Its buttons show on hover or focus, or after a tap on a touch
// screen: "Add Event" always, and "Add Travel" between two Events that both have a Google place.
function SlotRow({ from, to, startMinute, endMinute, createAt, range, open, onOpenChange, onCreateAt, onOpenLeg }: SlotRowProps) {
  const t = useT();
  // The minute that was tapped to show the buttons, so Add Event starts the new Event there.
  const [tapped, setTapped] = useState<number | undefined>();
  const top = toPx(startMinute - range.startMinute);
  if (top > toPx(range.endMinute - range.startMinute)) return null;
  const endpoints = from && to ? legEndpoints(from, to) : undefined;
  const canTravel = !!(from && to && endpoints?.fromPlaceId && endpoints.toPlaceId);
  const where = from && to
    ? t("slot.between", { from: from.title, to: to.title })
    : from
      ? t("slot.after", { title: from.title })
      : t("slot.before", { title: to!.title });

  // On a touch screen the first tap only shows the buttons, so nothing is triggered unseen.
  const touched = (e: MouseEvent) =>
    (e.nativeEvent as globalThis.PointerEvent).pointerType === "touch" || window.matchMedia("(hover: none)").matches;
  const touchReveal = (e: MouseEvent) => {
    if (open || !touched(e)) return false;
    e.stopPropagation();
    onOpenChange(true);
    return true;
  };

  return (
    <li
      className={open ? "slot-row open" : "slot-row"}
      style={{ top, height: toPx(endMinute - startMinute) }}
      onClick={(e) => {
        // A tap on the empty stretch itself toggles the buttons; a click elsewhere creates as usual.
        if ((e.target as HTMLElement).closest(".slot-actions") || !touched(e)) return;
        e.stopPropagation();
        const axis = e.currentTarget.parentElement!.getBoundingClientRect();
        const minute = minuteAtOffset(e.clientY - axis.top, range, PX_PER_HOUR);
        setTapped(Math.min(Math.max(minute, startMinute), Math.max(startMinute, endMinute - SNAP_MINUTES)));
        onOpenChange(!open);
      }}
    >
      <div className="slot-actions">
        <button
          type="button"
          aria-label={t("slot.addEventLabel", { where })}
          onClick={(e) => {
            if (touchReveal(e)) return;
            onOpenChange(false);
            onCreateAt(open && tapped !== undefined ? tapped : createAt);
          }}
        >
          <Plus size={14} aria-hidden="true" /> {t("slot.addEvent")}
        </button>
        {canTravel && (
          <button
            type="button"
            aria-label={t("leg.addBetween", { from: from!.title, to: to!.title })}
            onClick={(e) => {
              if (touchReveal(e)) return;
              onOpenChange(false);
              onOpenLeg({ from: from!, to: to! }, e.currentTarget);
            }}
          >
            <MODE_ICONS.transit size={14} aria-hidden="true" /> {t("leg.add")}
          </button>
        )}
      </div>
    </li>
  );
}
