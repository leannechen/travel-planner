import {
  formatMinute,
  layoutDay,
  MINUTES_PER_DAY,
  type Event,
} from "@travel-planner/shared";

export const PX_PER_HOUR = 64;
const MIN_EVENT_HEIGHT = 22;

type Range = { startMinute: number; endMinute: number };

const toPx = (minutes: number) => (minutes / 60) * PX_PER_HOUR;

export function HourLabels({ range }: { range: Range }) {
  const hours: number[] = [];
  for (let m = range.startMinute; m < range.endMinute; m += 60) hours.push(m);
  return (
    <div className="hour-labels" style={{ height: toPx(range.endMinute - range.startMinute) }} aria-hidden="true">
      {hours.map((m) => (
        <span key={m} style={{ top: toPx(m - range.startMinute) }}>
          {formatMinute(m)}
        </span>
      ))}
    </div>
  );
}

// One Day's Events on the shared axis. Events running past midnight are cut off there.
export function DayTimeline({ events, range }: { events: Event[]; range: Range }) {
  const placements = new Map(layoutDay(events).map((p) => [p.id, p]));
  const hours: number[] = [];
  for (let m = range.startMinute; m < range.endMinute; m += 60) hours.push(m);

  return (
    <ul className="day-timeline" style={{ height: toPx(range.endMinute - range.startMinute) }}>
      {hours.map((m) => (
        <li key={m} className="hour-line" style={{ top: toPx(m - range.startMinute) }} aria-hidden="true" />
      ))}
      {events.map((event) => {
        const placement = placements.get(event.id)!;
        const end = Math.min(event.startMinute + event.durationMinutes, MINUTES_PER_DAY);
        const height = Math.max(toPx(end - event.startMinute), MIN_EVENT_HEIGHT);
        return (
          <li
            key={event.id}
            className="event-card"
            style={{
              top: toPx(event.startMinute - range.startMinute),
              height: height - 2,
              left: `${(placement.column / placement.columnCount) * 100}%`,
              width: `${100 / placement.columnCount}%`,
            }}
          >
            <strong>{event.title}</strong>
            <span>
              {formatMinute(event.startMinute)} – {formatMinute(end)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
