import type { Day, Trip } from "@travel-planner/shared";
import { useEffect, useState } from "react";
import { addEvent, createTrip, listTrips } from "./api";
import { TitleForm } from "./TitleForm";
import { TripCard } from "./TripCard";

export function App() {
  const [trips, setTrips] = useState<Trip[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    listTrips().then(setTrips, (e: Error) => setError(e.message));
  }, []);

  async function handleCreateTrip(title: string) {
    const trip = await createTrip({ title });
    setTrips((current) => [trip, ...(current ?? [])]);
  }

  async function handleAddEvent(tripId: string, dayId: string, title: string) {
    const event = await addEvent(tripId, dayId, { title });
    setTrips((current) =>
      current?.map((trip) =>
        trip.id !== tripId
          ? trip
          : {
              ...trip,
              days: trip.days.map((day) =>
                day.id === dayId ? { ...day, events: [...day.events, event] } : day,
              ),
            },
      ),
    );
  }

  function handleDaysChange(tripId: string, newDays: Day[]) {
    setTrips((current) => current?.map((trip) => (trip.id === tripId ? { ...trip, days: newDays } : trip)));
  }

  return (
    <main>
      <h1>Travel Planner</h1>
      <TitleForm label="Trip title" submitLabel="Create trip" onSubmit={handleCreateTrip} />
      {error && <p role="alert">{error}</p>}
      {trips?.map((trip) => (
          <TripCard key={trip.id} trip={trip} onAddEvent={handleAddEvent} onDaysChange={handleDaysChange} />
        ))}
      {trips?.length === 0 && <p>No trips yet.</p>}
    </main>
  );
}
