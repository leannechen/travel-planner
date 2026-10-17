import {
  formatMinute,
  layoutDay,
  minuteAtOffset,
  MINUTES_PER_DAY,
  type Event,
} from "@travel-planner/shared";
import type { MouseEvent } from "react";

export const PX_PER_HOUR = 64;

type Range = { startMinute: number; endMinute: number };

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
};

// One Day's Events on the shared axis. Events running past midnight are cut off there.
export function DayTimeline({ events, range, selectedEventId, draft, onSelectEvent, onCreateAt }: Props) {
  const placements = new Map(layoutDay(events).map((p) => [p.id, p]));

  // Only clicks on the empty axis create; clicks on an Event card select it instead.
  // Keyboard users create through the Day's "Add event" button.
  function handleAxisClick(e: MouseEvent<HTMLUListElement>) {
    if ((e.target as HTMLElement).closest(".event-card, .new-event")) return;
    const top = e.currentTarget.getBoundingClientRect().top;
    onCreateAt(minuteAtOffset(e.clientY - top, range, PX_PER_HOUR));
  }

  return (
    <ul
      className="day-timeline"
      style={{ height: toPx(range.endMinute - range.startMinute) }}
      onClick={handleAxisClick}
    >
      {hourStarts(range).map((m) => (
        <li key={m} className="hour-line" style={{ top: toPx(m - range.startMinute) }} aria-hidden="true" />
      ))}
      {events.map((event) => {
        const placement = placements.get(event.id)!;
        const realEnd = event.startMinute + event.durationMinutes;
        const drawnHeight = toPx(Math.min(realEnd, MINUTES_PER_DAY) - event.startMinute);
        return (
          <li
            key={event.id}
            className={event.id === selectedEventId ? "event-card selected" : "event-card"}
            style={{
              top: toPx(event.startMinute - range.startMinute),
              height: drawnHeight - 2,
              left: `${(placement.column / placement.columnCount) * 100}%`,
              width: `${100 / placement.columnCount}%`,
            }}
          >
            <button type="button" onClick={() => onSelectEvent(event.id)}>
              <strong>{event.title}</strong>
              <span>
                {formatMinute(event.startMinute)} – {formatEnd(realEnd)}
              </span>
            </button>
          </li>
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
  );
}
