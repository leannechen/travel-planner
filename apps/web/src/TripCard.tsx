import { moveBy, type Day, type Trip } from "@travel-planner/shared";
import { Fragment, useState } from "react";
import { deleteDay, insertDay, reorderDays } from "./api";
import { TitleForm } from "./TitleForm";

type Props = {
  trip: Trip;
  onAddEvent: (tripId: string, dayId: string, title: string) => Promise<void>;
  onDaysChange: (tripId: string, days: Day[]) => void;
};

export function TripCard({ trip, onAddEvent, onDaysChange }: Props) {
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

  function insertButton(position: number) {
    return (
      <button type="button" disabled={busy} onClick={() => changeDays(() => insertDay(trip.id, position))}>
        Insert Day {position}
      </button>
    );
  }

  return (
    <article>
      <h2>{trip.title}</h2>
      {error && <p role="alert">{error}</p>}
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", overflowX: "auto" }}>
        {trip.days.map((day) => (
          <Fragment key={day.id}>
            <div>{insertButton(day.position)}</div>
            <section aria-label={`Day ${day.position}`} style={{ minWidth: "16rem" }}>
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
              <ul>
                {day.events.map((event) => (
                  <li key={event.id}>{event.title}</li>
                ))}
              </ul>
              <TitleForm
                label="Event title"
                submitLabel="Add event"
                disabled={busy}
                onSubmit={(title) => onAddEvent(trip.id, day.id, title)}
              />
            </section>
          </Fragment>
        ))}
        <div>{insertButton(lastPosition + 1)}</div>
      </div>
    </article>
  );
}
