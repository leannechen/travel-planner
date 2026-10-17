import { axisRange, DEFAULT_START_MINUTE, moveBy, type Day, type Trip } from "@travel-planner/shared";
import { useState } from "react";
import { deleteDay, insertDay, reorderDays } from "./api";
import { DayTimeline, HourLabels } from "./DayTimeline";

type Props = {
  trip: Trip;
  onDaysChange: (tripId: string, days: Day[]) => void;
  selectedEventId?: string;
  // A new Event being set up in the panel.
  draft?: { dayId: string; startMinute: number; durationMinutes: number };
  onSelectEvent: (eventId: string) => void;
  onCreateAt: (dayId: string, startMinute: number) => void;
};

export function TripCard({ trip, onDaysChange, selectedEventId, draft, onSelectEvent, onCreateAt }: Props) {
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // Runs one Day change at a time and replaces the Trip's Days with the server's answer.
  async function changeDays(action: () => Promise<Day[]>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      onDaysChange(trip.id, await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const dayIds = trip.days.map((d) => d.id);
  const lastPosition = trip.days.length;
  // One range for every Day, so the Days line up side by side.
  const range = axisRange(trip.days.flatMap((d) => d.events));

  function insertButton(position: number) {
    return (
      <button type="button" disabled={busy} onClick={() => changeDays(() => insertDay(trip.id, position))}>
        Insert Day {position}
      </button>
    );
  }

  // Grid: hour labels, then for each Day a narrow column for its Insert button and a Day column.
  const columns = `auto ${trip.days.map(() => "auto minmax(14rem, 1fr)").join(" ")} auto`;

  return (
    <article>
      <h2>{trip.title}</h2>
      {error && <p role="alert">{error}</p>}
      <div className="days-grid" style={{ gridTemplateColumns: columns }}>
        <div className="axis-cell" style={{ gridColumn: 1, gridRow: 2 }}>
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
                <button
                  type="button"
                  disabled={busy || day.events.length > 0 || lastPosition === 1}
                  title={day.events.length > 0 ? "Only an empty Day can be deleted" : undefined}
                  onClick={() => changeDays(() => deleteDay(trip.id, day.id))}
                >
                  Delete Day
                </button>
              </div>
              <button type="button" disabled={busy} onClick={() => onCreateAt(day.id, DEFAULT_START_MINUTE)}>
                Add event
              </button>
            </section>,
            <div key={`axis-${day.id}`} style={{ gridColumn: dayColumn, gridRow: 2 }}>
              <DayTimeline
                events={day.events}
                range={range}
                selectedEventId={selectedEventId}
                draft={draft?.dayId === day.id ? draft : undefined}
                onSelectEvent={onSelectEvent}
                onCreateAt={(startMinute) => onCreateAt(day.id, startMinute)}
              />
            </div>,
          ];
        })}
        <div style={{ gridColumn: 2 + lastPosition * 2, gridRow: 1 }}>{insertButton(lastPosition + 1)}</div>
      </div>
    </article>
  );
}
