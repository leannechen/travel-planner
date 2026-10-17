import { DEFAULT_DURATION_MINUTES, upsertEvent } from "@travel-planner/shared";
import type { CreateEventInput, Day, Trip, UpdateEventInput } from "@travel-planner/shared";
import { useEffect, useRef, useState } from "react";
import { addEvent, createTrip, listTrips, updateEvent } from "./api";
import { EventPanel } from "./EventPanel";
import { TitleForm } from "./TitleForm";
import { TripCard } from "./TripCard";

type Draft = { dayId: string; startMinute: number; durationMinutes: number };

// What the Event panel shows: an existing Event, or a new Event that is not saved yet.
type Selection = { tripId: string; eventId: string } | { tripId: string; draft: Draft };

export function App() {
  const [trips, setTrips] = useState<Trip[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [selection, setSelection] = useState<Selection | undefined>();
  // Changes when the user picks something else, so the panel starts fresh. It stays the same when
  // a new Event is saved, so the panel keeps its fields and focus.
  const [panelKey, setPanelKey] = useState(0);
  // The same number, readable from a save that finishes later.
  const panelKeyRef = useRef(0);

  useEffect(() => {
    listTrips().then(setTrips, (e: Error) => setError(e.message));
  }, []);

  async function handleCreateTrip(title: string) {
    const trip = await createTrip({ title });
    setTrips((current) => [trip, ...(current ?? [])]);
  }

  function setTripDays(tripId: string, change: (days: Day[]) => Day[]) {
    setTrips((current) =>
      current?.map((trip) => (trip.id === tripId ? { ...trip, days: change(trip.days) } : trip)),
    );
  }

  function select(next: Selection | undefined) {
    setSelection(next);
    panelKeyRef.current += 1;
    setPanelKey(panelKeyRef.current);
  }

  function handleDaysChange(tripId: string, newDays: Day[]) {
    setTripDays(tripId, () => newDays);
    // A new Event set up on a Day that no longer exists cannot be saved.
    if (selection?.tripId === tripId && "draft" in selection && !newDays.some((d) => d.id === selection.draft.dayId)) {
      select(undefined);
    }
  }

  async function handleCreateEvent(tripId: string, input: CreateEventInput, dayId: string) {
    const panel = panelKeyRef.current;
    const event = await addEvent(tripId, dayId, input);
    setTripDays(tripId, (days) => upsertEvent(days, event));
    // Follow the new Event only if the user is still on the panel that created it.
    if (panelKeyRef.current === panel) setSelection({ tripId, eventId: event.id });
    return event;
  }

  async function handleUpdateEvent(tripId: string, eventId: string, input: UpdateEventInput) {
    const event = await updateEvent(tripId, eventId, input);
    setTripDays(tripId, (days) => upsertEvent(days, event));
    return event;
  }

  // Dragging or resizing: show the new time at once, and put it back if saving fails.
  async function handleChangeTimes(
    tripId: string,
    eventId: string,
    times: { startMinute: number; durationMinutes: number },
  ) {
    const previous = trips
      ?.find((t) => t.id === tripId)
      ?.days.flatMap((d) => d.events)
      .find((e) => e.id === eventId);
    if (!previous) return;

    setError(undefined);
    setTripDays(tripId, (days) => upsertEvent(days, { ...previous, ...times }));
    // Reopen the panel so it shows the new time.
    select({ tripId, eventId });
    try {
      const event = await updateEvent(tripId, eventId, times);
      setTripDays(tripId, (days) => upsertEvent(days, event));
    } catch (err) {
      setTripDays(tripId, (days) => upsertEvent(days, previous));
      select({ tripId, eventId });
      setError(err instanceof Error ? err.message : "Could not save the new time");
    }
  }

  const selectedTrip = selection && trips?.find((t) => t.id === selection.tripId);
  const selectedEvent =
    selectedTrip && selection && "eventId" in selection
      ? selectedTrip.days.flatMap((d) => d.events).find((e) => e.id === selection.eventId)
      : undefined;

  return (
    <main className={selectedTrip ? "has-panel" : undefined}>
      <h1>Travel Planner</h1>
      <TitleForm label="Trip title" submitLabel="Create trip" onSubmit={handleCreateTrip} />
      {error && <p role="alert">{error}</p>}
      {trips?.map((trip) => {
        const mine = selection?.tripId === trip.id ? selection : undefined;
        return (
          <TripCard
            key={trip.id}
            trip={trip}
            onDaysChange={handleDaysChange}
            selectedEventId={mine && "eventId" in mine ? mine.eventId : undefined}
            draft={mine && "draft" in mine ? mine.draft : undefined}
            onChangeTimes={(eventId, times) => handleChangeTimes(trip.id, eventId, times)}
            onSelectEvent={(eventId) => {
              // Clicking the Event that is already open must not reset the panel.
              if (!(mine && "eventId" in mine && mine.eventId === eventId)) select({ tripId: trip.id, eventId });
            }}
            onCreateAt={(dayId, startMinute) =>
              select({
                tripId: trip.id,
                draft: { dayId, startMinute, durationMinutes: DEFAULT_DURATION_MINUTES },
              })
            }
          />
        );
      })}
      {trips?.length === 0 && <p>No trips yet.</p>}
      {selectedTrip && selection && (selectedEvent || "draft" in selection) && (
        <EventPanel
          key={panelKey}
          days={selectedTrip.days}
          event={selectedEvent}
          newEvent={"draft" in selection ? selection.draft : undefined}
          onCreate={(input, dayId) => handleCreateEvent(selectedTrip.id, input, dayId)}
          onUpdate={(eventId, input) => handleUpdateEvent(selectedTrip.id, eventId, input)}
          onDraftChange={(draft) =>
            setSelection((s) => (s && "draft" in s ? { ...s, draft } : s))
          }
          onClose={() => select(undefined)}
        />
      )}
    </main>
  );
}
