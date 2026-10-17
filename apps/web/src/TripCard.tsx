import type { Trip } from "@travel-planner/shared";
import { TitleForm } from "./TitleForm";

type Props = {
  trip: Trip;
  onAddEvent: (tripId: string, dayId: string, title: string) => Promise<void>;
};

export function TripCard({ trip, onAddEvent }: Props) {
  return (
    <article>
      <h2>{trip.title}</h2>
      {trip.days.map((day) => (
        <section key={day.id}>
          <h3>Day {day.position}</h3>
          <ul>
            {day.events.map((event) => (
              <li key={event.id}>{event.title}</li>
            ))}
          </ul>
          <TitleForm
            label="Event title"
            submitLabel="Add event"
            onSubmit={(title) => onAddEvent(trip.id, day.id, title)}
          />
        </section>
      ))}
    </article>
  );
}
