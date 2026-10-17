import { DEFAULT_DURATION_MINUTES, upsertEvent } from "@travel-planner/shared";
import type { CreateEventInput, Day, Event, Trip, UpdateEventInput } from "@travel-planner/shared";
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
  // Why a drag or resize could not be saved; kept apart from the load error.
  const [saveError, setSaveError] = useState<string | undefined>();
  const [selection, setSelection] = useState<Selection | undefined>();
  // Changes when the user picks something else, so the panel starts fresh. It stays the same when
  // a new Event is saved, so the panel keeps its fields and focus.
  const [panelKey, setPanelKey] = useState(0);
  // The same number, readable from a save that finishes later.
  const panelKeyRef = useRef(0);
  // The latest Trips, for saves that finish later.
  const tripsRef = useRef(trips);
  tripsRef.current = trips;
  // Saves of one Event can overlap (a drag while the panel is saving). Each save gets a number;
  // only the latest one for an Event may change the screen, so an older answer arriving late
  // cannot undo a newer one. `confirmed` is what the server last said about an Event.
  const saveCounts = useRef(new Map<string, number>());
  const confirmed = useRef(new Map<string, Event>());

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

  function beginSave(eventId: string) {
    const n = (saveCounts.current.get(eventId) ?? 0) + 1;
    saveCounts.current.set(eventId, n);
    return n;
  }

  const isLatestSave = (eventId: string, n: number) => saveCounts.current.get(eventId) === n;

  // Puts a saved Event on screen, unless a newer save for it has started since.
  function applySaved(tripId: string, event: Event, n: number) {
    if (!isLatestSave(event.id, n)) return;
    confirmed.current.set(event.id, event);
    setTripDays(tripId, (days) => upsertEvent(days, event));
  }

  async function handleUpdateEvent(tripId: string, eventId: string, input: UpdateEventInput) {
    const n = beginSave(eventId);
    const event = await updateEvent(tripId, eventId, input);
    applySaved(tripId, event, n);
    return event;
  }

  // Changes only the time of an Event already in `days`, whatever else changed meanwhile.
  function withTimes(days: Day[], eventId: string, times: { startMinute: number; durationMinutes: number }) {
    const event = days.flatMap((d) => d.events).find((e) => e.id === eventId);
    return event ? upsertEvent(days, { ...event, ...times }) : days;
  }

  // Dragging or resizing: show the new time at once, and put the last saved time back if saving
  // fails. The panel follows the Event's time by itself.
  async function handleChangeTimes(
    tripId: string,
    eventId: string,
    times: { startMinute: number; durationMinutes: number },
  ) {
    const current = tripsRef.current
      ?.find((t) => t.id === tripId)
      ?.days.flatMap((d) => d.events)
      .find((e) => e.id === eventId);
    if (!current) return;

    if (!confirmed.current.has(eventId)) confirmed.current.set(eventId, current);
    const n = beginSave(eventId);
    setSaveError(undefined);
    setTripDays(tripId, (days) => withTimes(days, eventId, times));
    try {
      applySaved(tripId, await updateEvent(tripId, eventId, times), n);
    } catch (err) {
      // A newer save has taken over; its own result decides what is shown.
      if (!isLatestSave(eventId, n)) return;
      const last = confirmed.current.get(eventId)!;
      setTripDays(tripId, (days) =>
        withTimes(days, eventId, { startMinute: last.startMinute, durationMinutes: last.durationMinutes }),
      );
      setSaveError(err instanceof Error ? err.message : "Could not save the new time");
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
      {saveError && <p role="alert">{saveError}</p>}
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
