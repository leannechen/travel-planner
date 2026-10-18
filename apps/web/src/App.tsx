import {
  allEvents,
  DEFAULT_DURATION_MINUTES,
  DEFAULT_START_MINUTE,
  dropEventTodos,
  isHoldingArea,
  needsTodoConfirmation,
  removeEvent,
  summarizeTodoDeletion,
  upsertEvent,
  type Areas,
  type DeletedEvent,
  type Todo,
  type TodoDeletionSummary,
} from "@travel-planner/shared";
import type { CreateEventInput, Day, Event, Trip, UpdateEventInput } from "@travel-planner/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addEvent,
  addHeldEvent,
  addTodo,
  createTrip,
  deleteEvent,
  deleteTodo,
  getMe,
  listTrips,
  restoreEvent,
  updateEvent,
  updateTodo,
} from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { EventPanel } from "./EventPanel";
import { Toast } from "./Toast";
import { TitleForm } from "./TitleForm";
import { TripCard, type EventMove } from "./TripCard";

// `dayId` is a Day id, or "backlog" or "archive" for an Event outside any Day.
type Draft = { dayId: string; startMinute: number; durationMinutes: number; kind?: Event["kind"] };

// What the Event panel shows: an existing Event, or a new Event that is not saved yet.
const emptyAreas: Areas = { days: [], backlog: [], archive: [] };

type Selection = { tripId: string; eventId: string } | { tripId: string; draft: Draft };

// "Do not remind me again" for the Todo-deletion dialogs. Kept in this browser until accounts exist
// (step 18); there is no setting to turn it back on in v1 (PRD §5).
const SKIP_REMINDER_KEY = "travel-planner.skip-todo-reminder";

function readSkipReminder() {
  try {
    return localStorage.getItem(SKIP_REMINDER_KEY) === "1";
  } catch {
    return false;
  }
}

function saveSkipReminder() {
  try {
    localStorage.setItem(SKIP_REMINDER_KEY, "1");
  } catch {
    // Without storage the dialog simply comes back next time.
  }
}

// An Event about to be archived or deleted, waiting for the user's answer.
type Removal = {
  action: "archive" | "delete";
  title: string;
  summary: TodoDeletionSummary;
  resolve: (confirmed: boolean) => void;
};

type Toasted = { id: number; message: string; undo?: () => void };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function App() {
  const [trips, setTrips] = useState<Trip[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  // Why a drag or resize could not be saved; kept apart from the load error.
  const [saveError, setSaveError] = useState<string | undefined>();
  const [selection, setSelection] = useState<Selection | undefined>();
  const [meId, setMeId] = useState<string | undefined>();
  const [removal, setRemoval] = useState<Removal | undefined>();
  const [toast, setToast] = useState<Toasted | undefined>();
  const dismissToast = useCallback(() => setToast(undefined), []);
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
    getMe().then((me) => setMeId(me.id), () => undefined);
  }, []);

  async function handleCreateTrip(title: string) {
    const trip = await createTrip({ title });
    setTrips((current) => [trip, ...(current ?? [])]);
  }

  function setTripAreas(tripId: string, change: (areas: Areas) => Areas) {
    setTrips((current) =>
      current?.map((trip) => (trip.id === tripId ? { ...trip, ...change(trip) } : trip)),
    );
  }

  function setTripTodos(tripId: string, change: (todos: Todo[]) => Todo[]) {
    setTrips((current) => current?.map((trip) => (trip.id === tripId ? { ...trip, todos: change(trip.todos) } : trip)));
  }

  // Asks before archiving or deleting an Event that has Todos, which go with it (PRD §5). Answers
  // true at once when there is nothing to ask. The answer "do not remind me again" is remembered.
  function confirmRemoval(trip: Trip, event: Event, action: Removal["action"]): Promise<boolean> {
    const summary = summarizeTodoDeletion(trip.todos, event.id, meId ?? "");
    if (!needsTodoConfirmation(summary, readSkipReminder())) return Promise.resolve(true);
    return new Promise((resolve) => setRemoval({ action, title: event.title, summary, resolve }));
  }

  function answerRemoval(confirmed: boolean, skipReminder = false) {
    if (!removal) return;
    if (confirmed && skipReminder) saveSkipReminder();
    removal.resolve(confirmed);
    setRemoval(undefined);
  }

  const showArchived = () => setToast({ id: Date.now(), message: "Moved to Archive" });

  function select(next: Selection | undefined) {
    setSelection(next);
    panelKeyRef.current += 1;
    setPanelKey(panelKeyRef.current);
  }

  // The server's answer after a Day change; the Backlog comes along when the change moves Events.
  function handleDaysChange(tripId: string, newDays: Day[], backlog?: Event[]) {
    setTripAreas(tripId, (areas) => ({ ...areas, days: newDays, backlog: backlog ?? areas.backlog }));
    // A new Event set up on a Day that no longer exists cannot be saved.
    const draftDay = selection && "draft" in selection ? selection.draft.dayId : undefined;
    if (selection?.tripId === tripId && draftDay && !isHoldingArea(draftDay) && !newDays.some((d) => d.id === draftDay)) {
      select(undefined);
    }
  }

  async function handleCreateEvent(tripId: string, input: CreateEventInput, place: string) {
    const panel = panelKeyRef.current;
    const event = isHoldingArea(place) ? await addHeldEvent(tripId, place, input) : await addEvent(tripId, place, input);
    setTripAreas(tripId, (areas) => upsertEvent(areas, event));
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
    // Archiving deleted the Event's Todos on the server, whichever save is the latest.
    if (event.holding === "archive") setTripTodos(tripId, (todos) => dropEventTodos(todos, event.id));
    if (!isLatestSave(event.id, n)) return;
    confirmed.current.set(event.id, event);
    setTripAreas(tripId, (areas) => upsertEvent(areas, event));
  }

  async function handleUpdateEvent(tripId: string, eventId: string, input: UpdateEventInput) {
    const trip = tripsRef.current?.find((t) => t.id === tripId);
    const current = trip && allEvents(trip).find((e) => e.id === eventId);
    if (trip && current && input.area === "archive" && current.holding !== "archive") {
      // Declined: nothing is saved, and the panel is handed the Event as it is.
      if (!(await confirmRemoval(trip, current, "archive"))) return current;
    }
    const n = beginSave(eventId);
    const event = await updateEvent(tripId, eventId, input);
    applySaved(tripId, event, n);
    if (input.area === "archive" && current?.holding !== "archive") showArchived();
    return event;
  }

  async function handleDeleteEvent(tripId: string, event: Event) {
    const trip = tripsRef.current?.find((t) => t.id === tripId);
    if (!trip || !(await confirmRemoval(trip, event, "delete"))) return;
    setSaveError(undefined);
    let deleted: DeletedEvent;
    try {
      deleted = await deleteEvent(tripId, event.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not delete the Event");
      return;
    }
    setTripAreas(tripId, (areas) => removeEvent(areas, event.id));
    setTripTodos(tripId, (todos) => dropEventTodos(todos, event.id));
    setSelection((s) => {
      if (s && "eventId" in s && s.eventId === event.id) {
        panelKeyRef.current += 1;
        setPanelKey(panelKeyRef.current);
        return undefined;
      }
      return s;
    });
    setToast({ id: Date.now(), message: `"${event.title}" deleted`, undo: () => undoDeleteEvent(tripId, deleted) });
  }

  async function undoDeleteEvent(tripId: string, deleted: DeletedEvent) {
    setToast(undefined);
    setSaveError(undefined);
    try {
      const event = await restoreEvent(tripId, deleted);
      setTripAreas(tripId, (areas) => upsertEvent(areas, event));
      setTripTodos(tripId, (todos) => [...todos, ...deleted.todos]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not undo the deletion");
    }
  }

  // The Todo handlers show a failure and pass it on, so a form can keep what was typed.
  async function failing<T>(action: () => Promise<T>): Promise<T> {
    setSaveError(undefined);
    try {
      return await action();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Something went wrong");
      throw err;
    }
  }

  const handleAddTodo = (tripId: string, text: string, eventId: string | null) =>
    failing(async () => {
      const todo = await addTodo(tripId, text, eventId);
      setTripTodos(tripId, (todos) => [...todos, todo]);
    });

  const handleToggleTodo = (tripId: string, todo: Todo) =>
    failing(async () => {
      const saved = await updateTodo(tripId, todo.id, { done: !todo.done });
      setTripTodos(tripId, (todos) => todos.map((t) => (t.id === saved.id ? saved : t)));
    }).catch(() => undefined);

  const handleDeleteTodo = (tripId: string, todo: Todo) =>
    failing(async () => {
      await deleteTodo(tripId, todo.id);
      setTripTodos(tripId, (todos) => todos.filter((t) => t.id !== todo.id));
    }).catch(() => undefined);

  // Changes only where and when an Event is, whatever else changed meanwhile.
  function withMove(areas: Areas, eventId: string, move: EventMove) {
    const event = allEvents(areas).find((e) => e.id === eventId);
    return event ? upsertEvent(areas, { ...event, ...move }) : areas;
  }

  // Dragging, resizing or moving to another area: show the result at once, and put the last saved
  // place and time back if saving fails. The panel follows the Event by itself.
  async function handleMove(tripId: string, eventId: string, move: EventMove) {
    const current = tripsRef.current && allEvents(tripsRef.current.find((t) => t.id === tripId) ?? emptyAreas).find((e) => e.id === eventId);
    if (!current) return;

    // Archiving deletes the Event's Todos, so it asks first when there are any.
    const trip = tripsRef.current?.find((t) => t.id === tripId);
    if (trip && move.holding === "archive" && current.holding !== "archive" && !(await confirmRemoval(trip, current, "archive"))) {
      return;
    }

    if (!confirmed.current.has(eventId)) confirmed.current.set(eventId, current);
    const n = beginSave(eventId);
    setSaveError(undefined);
    // A place is a Day or a holding area, never both: show it whole before the server answers.
    const shown: EventMove = move.holding ? { ...move, dayId: null } : move.dayId ? { ...move, holding: null } : move;
    setTripAreas(tripId, (areas) => withMove(areas, eventId, shown));
    const { dayId, holding, ...times } = move;
    const patch: UpdateEventInput = { ...times, ...(holding ? { area: holding } : dayId ? { dayId } : {}) };
    try {
      applySaved(tripId, await updateEvent(tripId, eventId, patch), n);
      if (move.holding === "archive" && current.holding !== "archive") showArchived();
    } catch (err) {
      // A newer save has taken over; its own result decides what is shown.
      if (!isLatestSave(eventId, n)) return;
      const last = confirmed.current.get(eventId)!;
      setTripAreas(tripId, (areas) =>
        withMove(areas, eventId, {
          startMinute: last.startMinute,
          durationMinutes: last.durationMinutes,
          dayId: last.dayId,
          holding: last.holding,
        }),
      );
      setSaveError(err instanceof Error ? err.message : "Could not move the Event");
    }
  }

  const selectedTrip = selection && trips?.find((t) => t.id === selection.tripId);
  const selectedEvent =
    selectedTrip && selection && "eventId" in selection
      ? allEvents(selectedTrip).find((e) => e.id === selection.eventId)
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
            onMove={(eventId, move) => handleMove(trip.id, eventId, move)}
            onAddTodo={(text, eventId) => handleAddTodo(trip.id, text, eventId)}
            onToggleTodo={(todo) => handleToggleTodo(trip.id, todo)}
            onDeleteTodo={(todo) => handleDeleteTodo(trip.id, todo)}
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
            onAddToBacklog={() =>
              select({
                tripId: trip.id,
                draft: { dayId: "backlog", startMinute: DEFAULT_START_MINUTE, durationMinutes: DEFAULT_DURATION_MINUTES },
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
          onCreate={(input, place) => handleCreateEvent(selectedTrip.id, input, place)}
          onUpdate={(eventId, input) => handleUpdateEvent(selectedTrip.id, eventId, input)}
          onDraftChange={(draft) =>
            setSelection((s) => (s && "draft" in s ? { ...s, draft } : s))
          }
          onClose={() => select(undefined)}
          todos={selectedEvent ? selectedTrip.todos.filter((t) => t.eventId === selectedEvent.id) : []}
          onAddTodo={(text, eventId) => handleAddTodo(selectedTrip.id, text, eventId)}
          onToggleTodo={(todo) => handleToggleTodo(selectedTrip.id, todo)}
          onDeleteTodo={(todo) => handleDeleteTodo(selectedTrip.id, todo)}
          onDelete={(event) => handleDeleteEvent(selectedTrip.id, event)}
        />
      )}
      {removal && (
        <ConfirmDialog
          title={`${removal.action === "archive" ? "Archive" : "Delete"} “${removal.title}”?`}
          confirmLabel={removal.action === "archive" ? "Archive Event" : "Delete Event"}
          tone={removal.action === "archive" ? "primary" : "danger"}
          reminderOption
          onConfirm={(skip) => answerRemoval(true, skip)}
          onCancel={() => answerRemoval(false)}
        >
          <p>
            <strong>{plural(removal.summary.count, "Todo")}</strong> will be deleted
            {removal.summary.byOthers > 0 && `, including ${removal.summary.byOthers} created by someone else`}.
          </p>
          <ul>
            {removal.action === "archive" ? (
              <>
                <li>Archiving removes this Event’s Todos. Taking the Event back from the Archive does not restore them.</li>
                <li>The Event moves to the Archive. There is no undo for archiving.</li>
              </>
            ) : (
              <li>You can undo for a few seconds after deleting. Undo restores the Todos too.</li>
            )}
          </ul>
        </ConfirmDialog>
      )}
      {toast && <Toast key={toast.id} message={toast.message} actionLabel={toast.undo ? "Undo" : undefined} onAction={toast.undo} onDismiss={dismissToast} />}
    </main>
  );
}
