import {
  adjacentDayId,
  allEvents,
  axisRange,
  DEFAULT_DURATION_MINUTES,
  DEFAULT_START_MINUTE,
  dropEventTodos,
  isHoldingArea,
  moveEvent,
  keepAdjacentLegs,
  needsTodoConfirmation,
  neighbour,
  noteTitle,
  removeEvent,
  SNAP_MINUTES,
  summarizeTodoDeletion,
  upsertEvent,
  type Direction,
  type Areas,
  type DeletedEvent,
  type Note,
  type Todo,
  type TodoDeletionSummary,
} from "@travel-planner/shared";
import type { CreateEventInput, CreateTripInput, CreateLegInput, Day, Event, EventFields, Generation, Leg, LivePerson, TravelMode, Trip, UpdateEventInput } from "@travel-planner/shared";
import { Map as MapIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addEvent,
  addHeldEvent,
  addNote,
  addTodo,
  createLeg,
  createTrip,
  deleteEvent,
  deleteLeg,
  deleteNote,
  deleteTodo,
  getMe,
  listLegs,
  listTrips,
  restoreEvent,
  restoreNote,
  removeEventImage,
  uploadEventImage,
  turnOffOpeningHours,
  updateTrip,
  deleteTrip,
  exportBackup,
  importBackup,
  turnOnOpeningHours,
  updateEvent,
  updateLegMode,
  updateNote,
  updateTodo,
  writeActivity,
} from "./api";
import { AccountMenu, ExpiredBanner, GuestBanner, LoginErrorStrip } from "./AccountMenu";
import { useAuth } from "./AuthProvider";
import { Collaborators } from "./Collaborators";
import { ChangedEventsContext } from "./liveContext";
import { TripIdContext } from "./eventImage";
import { openLive } from "./live";
import { SharedTripPage, sharedTokenOf } from "./SharedTripPage";
import { LOGGED_OUT_PARAM } from "./authClient";
import { ConfirmDialog } from "./ConfirmDialog";
import { InvitePage } from "./InvitePage";
import { Landing } from "./Landing";
import { ShareDialog } from "./ShareDialog";
import { clearNotice, clearPendingEdits, keepPendingEdits, peekNotice, peekPendingEdits } from "./pendingEdits";
import { useIsPhone, useRoomForPinnedList } from "./phone";
import { EventPanel } from "./EventPanel";
import { rememberOpeningHours } from "./openingHours";
import { TripSettingsDialog } from "./TripSettingsDialog";
import { tripStartDate } from "./tripDates";
import { useUnsavedGuard } from "./unsavedGuard";
import { UnsavedDialog } from "./UnsavedDialog";
import { NotesPanel } from "./NotesPanel";
import { Sidebar } from "./Sidebar";
import { useT } from "./preferences";
import { ShortcutSheet } from "./ShortcutSheet";
import { Toast } from "./Toast";
import { TitleForm } from "./TitleForm";
import { chooseTrip, hasTripInAddress, isLandingLocation, openTrip, readWantedTripId, rememberTripId, wantsTripList } from "./currentTrip";
import { NewTripDialog } from "./NewTripDialog";
import { TripListDrawer } from "./TripListDrawer";
import { backupFileName, saveTextFile } from "./backupFile";
import { useTripGeneration } from "./tripGeneration";
import { TripCard, type EventMove, type Toasted } from "./TripCard";

// `dayId` is a Day id, or "backlog" or "archive" for an Event outside any Day.
type Draft = { dayId: string; startMinute: number; durationMinutes: number; kind?: Event["kind"] };

// What the Event panel shows: an existing Event, or a new Event that is not saved yet.
const emptyAreas: Areas = { days: [], backlog: [], archive: [] };

// `quiet`: chosen with the keyboard, so the panel must not take the focus.
// `restored`: the typed fields kept across a login redirect, for the panel to start with.
type Selection = { tripId: string; eventId: string; quiet?: boolean; restored?: EventFields } | { tripId: string; draft: Draft; restored?: EventFields };

// Where the user is heading when leaving the panel: another selection, or another Trip.
type Heading = Selection | { switchTo: string };

// Whether the Trip list is pinned open (design 27, C), kept in this browser.
const LIST_PINNED_KEY = "travel-planner.trip-list-pinned";

function readListPinned() {
  try {
    return localStorage.getItem(LIST_PINNED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveListPinned(value: boolean) {
  try {
    localStorage.setItem(LIST_PINNED_KEY, value ? "1" : "0");
  } catch {
    // Without storage the list is unpinned next time.
  }
}

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

const INVITE_PARAM = "invite";
// How long an Event changed by someone else stays lit.
const CHANGE_HIGHLIGHT_MS = 4000;

function leaveInvitation() {
  const url = new URL(window.location.href);
  url.searchParams.delete(INVITE_PARAM);
  window.history.replaceState(null, "", url);
}

// The address Auth0 sends the browser back to; it is replaced by the page the login came from.
function isLoginCallback() {
  const params = new URLSearchParams(window.location.search);
  return params.has("code") && params.has("state");
}

// The root address is the Landing page; a Trip, an invitation, a share link and the login page's
// answer have addresses of their own. Decided when the page opens and when the user goes Back or
// Forward, not on every render: the workspace may leave the root address in place when no Trip is open.
export function App() {
  const t = useT();
  const [landing, setLanding] = useState(isLandingLocation);
  // The toast of the Landing page after Log out; not shown again when the user comes back to the page.
  const [loggedOut, setLoggedOut] = useState(() => new URLSearchParams(window.location.search).has(LOGGED_OUT_PARAM));
  useEffect(() => {
    const onPop = () => setLanding(isLandingLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const auth = useAuth();
  // Back from the login page the address only becomes the page the login started from once the
  // session is known, so the page is decided again then (a login from the Landing page returns to it).
  const loginAnswered = useRef(isLoginCallback());
  useEffect(() => {
    if (!loginAnswered.current || auth.status === "loading") return;
    loginAnswered.current = false;
    setLanding(isLandingLocation());
  }, [auth.status]);
  // An invitation link is open until it was accepted or the user goes to their own Trips. Not read
  // while the login redirect is being finished: the address only becomes the invitation link after.
  const [leftInvite, setLeftInvite] = useState(false);
  const invite = leftInvite ? null : new URLSearchParams(window.location.search).get(INVITE_PARAM);
  const [joined, setJoined] = useState<string | undefined>();
  if (landing) {
    return (
      <Landing
        loggedOut={loggedOut}
        onOpenTrip={(tripId) => {
          openTrip(tripId);
          setLoggedOut(false);
          setLanding(false);
        }}
      />
    );
  }
  if (auth.status === "loading" && isLoginCallback()) return null;
  const shared = sharedTokenOf(window.location.pathname);
  if (shared) return <SharedTripPage token={shared} />;
  if (invite) {
    return (
      <InvitePage
        token={invite}
        onLeave={() => {
          leaveInvitation();
          setLeftInvite(true);
        }}
        onJoined={({ tripId, tripTitle }) => {
          rememberTripId(tripId);
          leaveInvitation();
          setJoined(t("invite.joined", { trip: tripTitle }));
          setLeftInvite(true);
        }}
      />
    );
  }
  return <Workspace joinedMessage={joined} />;
}

function Workspace({ joinedMessage }: { joinedMessage?: string }) {
  const t = useT();
  const auth = useAuth();
  const phone = useIsPhone();
  // The session ended: the Trip stays on screen, read-only, until the user logs in again.
  const expired = auth.status === "expired";
  // Logged in with nothing to add from a guest session: no Trip is open, the Trip list is.
  const [chooser, setChooser] = useState(false);
  // Edits kept across a login redirect, restored once the Trips are in.
  const [pending, setPending] = useState(peekPendingEdits);
  const [trips, setTrips] = useState<Trip[] | undefined>();
  // The page shows one Trip at a time: the one in the URL or this browser, else the first.
  const [wantedTripId, setWantedTripId] = useState(readWantedTripId);
  const [tripListOpen, setTripListOpen] = useState(wantsTripList);
  // The Trip list pinned open beside the Days on desktop, kept in this browser (design 27, C).
  const [listPinned, setListPinned] = useState(readListPinned);
  const roomForPin = useRoomForPinnedList();
  const pinnedList = listPinned && roomForPin;
  const [error, setError] = useState<string | undefined>();
  // Why a drag or resize could not be saved; kept apart from the load error.
  const [saveError, setSaveError] = useState<string | undefined>();
  const [selection, setSelection] = useState<Selection | undefined>();
  const [meId, setMeId] = useState<string | undefined>();
  const [removal, setRemoval] = useState<Removal | undefined>();
  const [toast, setToast] = useState<Toasted | undefined>(() => (joinedMessage ? { id: Date.now(), message: joinedMessage } : undefined));
  const [sheetOpen, setSheetOpen] = useState(false);
  // The Trip whose Notes panel is open. The shortcut opens it for the Trip being worked on.
  const [notesTripId, setNotesTripId] = useState<string | undefined>();
  // The open panel's own close, which saves what is typed first.
  const closeNotes = useRef<(() => Promise<boolean>) | undefined>(undefined);
  // The same id, readable from a switch that finishes later.
  const notesTripIdRef = useRef(notesTripId);
  notesTripIdRef.current = notesTripId;
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

  // A login that finishes after the first load failed (the session had ended while away) loads them.
  const loggedIn = auth.status === "user";
  useEffect(() => {
    if (!loggedIn || tripsRef.current !== undefined) return;
    setError(undefined);
    listTrips().then(setTrips, (e: Error) => setError(e.message));
    getMe().then((me) => setMeId(me.id), () => undefined);
  }, [loggedIn]);

  // What failed while the session was ending is no longer true once the user is logged in again.
  useEffect(() => {
    if (!expired) setSaveError(undefined);
  }, [expired]);

  // Back from the login page: Trips of the guest session were added to the account (say so and stay
  // in the Trip), or there was nothing to add and the user lands on the Trip list.
  const { arrival } = auth;
  useEffect(() => {
    if (!arrival) return;
    // The "You joined" message is the news when both apply.
    if (joinedMessage) return;
    if (arrival.merged > 0) setToast({ id: Date.now(), message: t("auth.merged", { count: arrival.merged }) });
    else if (!hasTripInAddress()) {
      setChooser(true);
      setTripListOpen(true);
    }
  }, [arrival]);

  // The page was reloaded because another account logged in under unsaved edits.
  useEffect(() => {
    if (!peekNotice()) return;
    clearNotice();
    setToast({ id: Date.now(), message: t("auth.otherAccount") });
  }, []);

  // Put back the Event panel and what was typed in it when the page left for the login page.
  useEffect(() => {
    if (!pending || !trips) return;
    setPending(undefined);
    clearPendingEdits();
    const trip = trips.find((tr) => tr.id === pending.tripId);
    if (!trip) {
      // Logged in as someone else: those edits belong to a Trip this account does not have.
      setToast({ id: Date.now(), message: t("auth.otherAccount") });
      return;
    }
    setWantedTripId(trip.id);
    if (pending.newEvent) {
      setSelection({ tripId: trip.id, draft: { ...pending.newEvent, kind: pending.fields.kind }, restored: pending.fields });
    } else if (pending.eventId && allEvents(trip).some((e) => e.id === pending.eventId)) {
      setSelection({ tripId: trip.id, eventId: pending.eventId, restored: pending.fields });
    }
  }, [pending, trips]);

  // The Trip whose Share dialog is open.
  const [shareTripId, setShareTripId] = useState<string | undefined>();
  // The Trip whose settings are open.
  const [settingsTripId, setSettingsTripId] = useState<string | undefined>();

  async function handleChangeStartDate(tripId: string, startDate: string | null) {
    const saved = await updateTrip(tripId, { startDate });
    setTrips((current) => current?.map((trip) => (trip.id === tripId ? { ...trip, startDate: saved.startDate } : trip)));
  }

  async function handleRenameTrip(tripId: string, title: string) {
    const saved = await updateTrip(tripId, { title });
    setTrips((current) => current?.map((trip) => (trip.id === tripId ? { ...trip, title: saved.title } : trip)));
  }

  // Saves the Trip's full backup as a file (PRD §9).
  async function handleExportTrip(tripId: string) {
    if (auth.status === "guest") {
      setTripListOpen(false);
      void auth.login();
      return;
    }
    const text = await exportBackup(tripId);
    saveTextFile(backupFileName(trips?.find((trip) => trip.id === tripId)?.title ?? ""), text);
  }

  // A new Trip from a backup file; it opens like a Trip just made.
  async function handleImportBackup(file: File) {
    const trip = await importBackup(await file.text());
    setTrips((current) => [trip, ...(current ?? [])]);
    switchTrip(trip.id);
  }

  // The Trip list, as a drawer over the Backlog or pinned as a column beside the Days.
  function tripListView(pinned: boolean) {
    if (!trips) return undefined;
    return (
      <TripListDrawer
        readOnly={expired}
        trips={trips}
        currentId={currentTripId}
        onSwitch={switchTrip}
        onCreate={handleCreateTrip}
        generation={auth.status === "user" ? generation : undefined}
        onRename={handleRenameTrip}
        onDelete={handleDeleteTrip}
        onExport={handleExportTrip}
        onImport={handleImportBackup}
        onImportLogin={auth.status === "guest" ? () => { setTripListOpen(false); void auth.login(); } : undefined}
        // These open on top of the list, so Cancel leaves the list as it was.
        onOpenSettings={setSettingsTripId}
        onShare={(tripId) => { if (auth.status === "guest") void auth.login(); else setShareTripId(tripId); }}
        onClose={() => setTripListOpen(false)}
        pinned={pinned}
        onTogglePin={!roomForPin ? undefined : () => {
          const next = !listPinned;
          setListPinned(next);
          saveListPinned(next);
          // Pinning turns the drawer into the column; unpinning turns the column back into the drawer.
          setTripListOpen(!next);
        }}
      />
    );
  }

  // The next Trip to show is the first one left; the page's own choice takes care of it.
  async function handleDeleteTrip(tripId: string) {
    await deleteTrip(tripId);
    setTrips((current) => current?.filter((trip) => trip.id !== tripId));
  }

  // AI generation (PRD §7), followed for the whole page. When it is done, the new Trip opens if the
  // Generate dialog is still open; otherwise a toast says it is ready.
  const generation = useTripGeneration(auth.status === "user", (finished, watching) => void handleGenerated(finished, watching));
  // Generate with AI opened from the failure toast's "Try again".
  const [retryingGeneration, setRetryingGeneration] = useState(false);
  async function handleGenerated(finished: Generation, watching: boolean) {
    if (!finished.tripId) {
      // The dialog shows why itself; otherwise the toast offers to try again with the same prompt.
      if (!watching) setToast({ id: Date.now(), message: t("ai.failedToast"), actionLabel: t("ai.tryAgain"), undo: () => setRetryingGeneration(true) });
      return;
    }
    const trip = (await listTrips().catch(() => [])).find((tr) => tr.id === finished.tripId);
    if (!trip) {
      setToast({ id: Date.now(), message: t("ai.readyReload") });
      return;
    }
    setTrips((current) => [trip, ...(current ?? []).filter((tr) => tr.id !== trip.id)]);
    if (watching) switchTrip(trip.id);
    else setToast({ id: Date.now(), message: t("ai.ready", { title: trip.title }), actionLabel: t("ai.open"), undo: () => switchTrip(trip.id) });
  }

  async function handleCreateTrip(input: CreateTripInput) {
    const trip = await createTrip(input);
    setTrips((current) => [trip, ...(current ?? [])]);
    switchTrip(trip.id);
  }

  // Shows another Trip, after the usual question about unsaved changes in the Event panel.
  function switchTrip(tripId: string) {
    setTripListOpen(false);
    if (tripId !== currentTrip?.id) select({ switchTo: tripId });
  }

  // Legs between Events that stop being adjacent go at once; the server decides for good and
  // `refreshLegs` brings its answer (including recalculated durations) afterwards.
  function setTripAreas(tripId: string, change: (areas: Areas) => Areas) {
    setTrips((current) =>
      current?.map((trip) => {
        if (trip.id !== tripId) return trip;
        const changed = { ...trip, ...change(trip) };
        return { ...changed, legs: keepAdjacentLegs(changed.days, changed.legs) };
      }),
    );
  }

  function setTripLegs(tripId: string, change: (legs: Leg[]) => Leg[]) {
    setTrips((current) => current?.map((trip) => (trip.id === tripId ? { ...trip, legs: change(trip.legs) } : trip)));
  }

  // Only the newest answer counts: a slower, older list must not undo a Leg changed since.
  const legRequests = useRef(0);
  async function refreshLegs(tripId: string) {
    const n = ++legRequests.current;
    try {
      const fresh = await listLegs(tripId);
      if (n === legRequests.current) setTripLegs(tripId, () => fresh);
    } catch {
      // The Legs on screen stay as they are until the next change.
    }
  }

  async function handleCreateLeg(tripId: string, input: CreateLegInput) {
    legRequests.current++;
    const leg = await createLeg(tripId, input);
    setTripLegs(tripId, (legs) => [...legs.filter((l) => l.id !== leg.id), leg]);
    void refreshLegs(tripId);
    return leg;
  }

  async function handleChangeLegMode(tripId: string, leg: Leg, mode: TravelMode) {
    legRequests.current++;
    const changed = await updateLegMode(tripId, leg.id, mode);
    setTripLegs(tripId, (legs) => legs.map((l) => (l.id === changed.id ? changed : l)));
    void refreshLegs(tripId);
  }

  async function handleDeleteLeg(tripId: string, leg: Leg) {
    legRequests.current++;
    await deleteLeg(tripId, leg.id);
    setTripLegs(tripId, (legs) => legs.filter((l) => l.id !== leg.id));
    void refreshLegs(tripId);
  }

  function setTripNotes(tripId: string, change: (notes: Note[]) => Note[]) {
    setTrips((current) => current?.map((trip) => (trip.id === tripId ? { ...trip, notes: change(trip.notes) } : trip)));
  }

  function setTripTodos(tripId: string, change: (todos: Todo[]) => Todo[]) {
    setTrips((current) => current?.map((trip) => (trip.id === tripId ? { ...trip, todos: change(trip.todos) } : trip)));
  }

  // Asks before archiving or deleting an Event that has Todos, which go with it (PRD §5). Answers
  // true at once when there is nothing to ask. The answer "do not remind me again" is remembered.
  function confirmRemoval(trip: Trip, event: Event, action: Removal["action"]): Promise<boolean> {
    const counted = summarizeTodoDeletion(trip.todos, event.id, meId ?? "");
    // Until we know who the user is, no Todo can be called someone else's.
    const summary = meId ? counted : { ...counted, byOthers: 0 };
    if (!needsTodoConfirmation(summary, readSkipReminder())) return Promise.resolve(true);
    return new Promise((resolve) => setRemoval({ action, title: event.title, summary, resolve }));
  }

  function answerRemoval(confirmed: boolean, skipReminder = false) {
    if (!removal) return;
    if (confirmed && skipReminder) saveSkipReminder();
    removal.resolve(confirmed);
    setRemoval(undefined);
  }

  const showArchived = () => setToast({ id: Date.now(), message: t("event.archived") });

  async function apply(next: Heading | undefined) {
    if (next && "switchTo" in next) {
      // Notes of the Trip being left close first, saving what is typed. A failed save keeps them
      // open, and the Trip stays.
      if (notesTripIdRef.current && closeNotes.current && !(await closeNotes.current())) return;
      setWantedTripId(next.switchTo);
      setChooser(false);
      setSelection(undefined);
    } else {
      setSelection(next);
    }
    panelKeyRef.current += 1;
    setPanelKey(panelKeyRef.current);
  }
  const guard = useUnsavedGuard<Heading>(apply);
  const { panelApi, select } = guard;

  // Logs in again after the session ended, in a popup so the Trip and the open Event panel stay as
  // they are. Resolves true when the same account is logged in again and edits can be saved. If the
  // browser blocks the popup, what is typed in the panel is kept in sessionStorage and the page goes
  // to the login page; it is restored when the page comes back.
  async function relogin(typed?: EventFields): Promise<boolean> {
    const outcome = await auth.loginInPlace();
    if (outcome === "same") return true;
    if (outcome === "blocked") {
      // An open Notes panel saves itself; when it cannot (the session has ended), a redirect would
      // lose its text, so stay and say so.
      if (notesTripIdRef.current && closeNotes.current && !(await closeNotes.current())) {
        setToast({ id: Date.now(), message: t("auth.notesUnsaved") });
        return false;
      }
      const fields = typed ?? (panelApi.current?.isDirty() ? panelApi.current.fields() : undefined);
      if (fields && selection) {
        keepPendingEdits({
          tripId: selection.tripId,
          eventId: "eventId" in selection ? selection.eventId : undefined,
          newEvent: "draft" in selection ? { dayId: selection.draft.dayId, startMinute: selection.draft.startMinute, durationMinutes: selection.draft.durationMinutes } : undefined,
          fields,
        });
      }
      await auth.login();
    }
    return false;
  }

  // The server's answer after a Day change; the Backlog comes along when the change moves Events.
  function handleDaysChange(tripId: string, newDays: Day[], backlog?: Event[]) {
    setTripAreas(tripId, (areas) => ({ ...areas, days: newDays, backlog: backlog ?? areas.backlog }));
    void refreshLegs(tripId);
    // A new Event set up on a Day that no longer exists cannot be saved.
    const draftDay = selection && "draft" in selection ? selection.draft.dayId : undefined;
    if (selection?.tripId === tripId && draftDay && !isHoldingArea(draftDay) && !newDays.some((d) => d.id === draftDay)) {
      select(undefined, true);
    }
  }

  async function handleCreateEvent(tripId: string, input: CreateEventInput, place: string) {
    const panel = panelKeyRef.current;
    const event = isHoldingArea(place) ? await addHeldEvent(tripId, place, input) : await addEvent(tripId, place, input);
    setTripAreas(tripId, (areas) => upsertEvent(areas, event));
    void refreshLegs(tripId);
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
    void refreshLegs(tripId);
    if (input.area === "archive" && current?.holding !== "archive") showArchived();
    return event;
  }

  // Puts the opening-hours choice the server answered into the Event as it is on screen now, without
  // the save counter: a slower answer must not drop a newer save of the same Event, nor be dropped by
  // it. Only while the Event still has the place the answer is for.
  function applyOpeningHoursChoice(tripId: string, answer: Event) {
    const patch = (e: Event) => (e.placeId === answer.placeId ? { ...e, openingHoursOn: answer.openingHoursOn } : e);
    setTripAreas(tripId, (areas) => {
      const current = [...areas.days.flatMap((d) => d.events), ...areas.backlog, ...areas.archive].find((e) => e.id === answer.id);
      return current ? upsertEvent(areas, patch(current)) : areas;
    });
    const last = confirmed.current.get(answer.id);
    if (last) confirmed.current.set(answer.id, patch(last));
  }

  // Opening hours are turned on and off at once, apart from the panel's Save.
  async function handleTurnOnHours(tripId: string, eventId: string) {
    const { event, hours } = await turnOnOpeningHours(tripId, eventId);
    // The hours belong to the place the answer's Event has; the server leaves the choice off when the
    // place changed in the meantime.
    if (hours && event.openingHoursOn && event.placeId) rememberOpeningHours(event.placeId, hours);
    applyOpeningHoursChoice(tripId, event);
    return hours && event.openingHoursOn ? ("on" as const) : ("none" as const);
  }

  async function handleTurnOffHours(tripId: string, eventId: string) {
    applyOpeningHoursChoice(tripId, await turnOffOpeningHours(tripId, eventId));
  }

  // Puts the image the server answered into the Event as it is on screen now, without the save
  // counter, for the same reason as the opening-hours choice: it is separate from the other fields.
  function applyImageChange(tripId: string, answer: Event) {
    const patch = (e: Event) => ({ ...e, imageId: answer.imageId });
    setTripAreas(tripId, (areas) => {
      const current = [...areas.days.flatMap((d) => d.events), ...areas.backlog, ...areas.archive].find((e) => e.id === answer.id);
      return current ? upsertEvent(areas, patch(current)) : areas;
    });
    const last = confirmed.current.get(answer.id);
    if (last) confirmed.current.set(answer.id, patch(last));
  }

  // An image is uploaded or removed by the panel's Save, after the other fields are saved.
  async function handleChangeImage(tripId: string, eventId: string, change: { file: File } | "remove") {
    const answer = change === "remove" ? await removeEventImage(tripId, eventId) : await uploadEventImage(tripId, eventId, change.file);
    applyImageChange(tripId, answer);
    return answer;
  }

  const deleting = useRef(new Set<string>());

  async function handleDeleteEvent(tripId: string, event: Event) {
    const trip = tripsRef.current?.find((t) => t.id === tripId);
    // A second press while the first delete is still running does nothing.
    if (!trip || deleting.current.has(event.id)) return;
    deleting.current.add(event.id);
    try {
      await removeConfirmedEvent(trip, event);
    } finally {
      deleting.current.delete(event.id);
    }
  }

  async function removeConfirmedEvent(trip: Trip, event: Event) {
    const tripId = trip.id;
    if (!(await confirmRemoval(trip, event, "delete"))) return;
    setSaveError(undefined);
    // Older saves of this Event still in flight must not put it back on the board.
    beginSave(event.id);
    let deleted: DeletedEvent;
    try {
      deleted = await deleteEvent(tripId, event.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("event.deleteFailed"));
      return;
    }
    setTripAreas(tripId, (areas) => removeEvent(areas, event.id));
    setTripTodos(tripId, (todos) => dropEventTodos(todos, event.id));
    void refreshLegs(tripId);
    if (selection && "eventId" in selection && selection.eventId === event.id) select(undefined, true);
    setToast({ id: Date.now(), message: t("event.deleted", { title: event.title }), undo: () => undoDeleteEvent(tripId, deleted) });
  }

  async function undoDeleteEvent(tripId: string, deleted: DeletedEvent) {
    setToast(undefined);
    setSaveError(undefined);
    try {
      const event = await restoreEvent(tripId, deleted);
      setTripAreas(tripId, (areas) => upsertEvent(areas, event));
      void refreshLegs(tripId);
      setTripTodos(tripId, (todos) => [...todos, ...deleted.todos]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("day.undoFailed"));
    }
  }

  // The Todo handlers show a failure and pass it on, so a form can keep what was typed.
  async function failing<T>(action: () => Promise<T>): Promise<T> {
    setSaveError(undefined);
    try {
      return await action();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("generic.error"));
      throw err;
    }
  }

  const handleAddTodo = (tripId: string, text: string, eventId: string | null) =>
    failing(async () => {
      const todo = await addTodo(tripId, text, eventId);
      setTripTodos(tripId, (todos) => [...todos, todo]);
    });

  const handleAddNote = (tripId: string, body: string) =>
    failing(async () => {
      const note = await addNote(tripId, body);
      setTripNotes(tripId, (notes) => [note, ...notes]);
      return note;
    });

  const handleUpdateNote = (tripId: string, noteId: string, input: { body?: string; pinned?: boolean }) =>
    failing(async () => {
      const note = await updateNote(tripId, noteId, input);
      setTripNotes(tripId, (notes) => notes.map((n) => (n.id === note.id ? note : n)));
    });

  // Deleting a Note needs no confirmation; the toast offers Undo for a few seconds.
  const handleDeleteNote = (tripId: string, note: Note) =>
    failing(async () => {
      await deleteNote(tripId, note.id);
      setTripNotes(tripId, (notes) => notes.filter((n) => n.id !== note.id));
      setToast({ id: Date.now(), message: t("notes.deleted", { title: noteTitle(note.body, t("notes.emptyTitle")) }), undo: () => undoDeleteNote(tripId, note) });
    });

  async function undoDeleteNote(tripId: string, note: Note) {
    setToast(undefined);
    setSaveError(undefined);
    try {
      const restored = await restoreNote(tripId, note);
      setTripNotes(tripId, (notes) => [restored, ...notes.filter((n) => n.id !== restored.id)]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("day.undoFailed"));
    }
  }

  function toggleNotes(tripId: string) {
    if (notesTripId === tripId) return void closeNotes.current?.();
    setNotesTripId(tripId);
  }

  // The Trip the keyboard works on: the one shown.

  // Ctrl+Alt+N opens or closes the Notes panel from anywhere. (Browsers keep Ctrl+Shift+N, and
  // Alt+Shift switches the input language on Windows.)
  function notesShortcut() {
    if (notesTripId) return void closeNotes.current?.();
    const target = currentTrip;
    if (target) toggleNotes(target.id);
  }

  // Selecting with the arrow keys moves the focus to the card too, without opening the panel's
  // fields, so the next arrow key still works.
  function selectByKey(tripId: string, eventId: string) {
    select({ tripId, eventId, quiet: true });
    setTimeout(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-event-id="${eventId}"]`,
      );
      (element?.matches("button")
        ? element
        : element?.querySelector("button")
      )?.focus();
    }, 0);
  }

  const ARROWS: Record<string, Direction> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };

  // Single keys work only when no text field has focus and no dialog is open (PRD §13).
  function handleKey(e: KeyboardEvent) {
    if (e.defaultPrevented || expired) return;
    if (
      e.code === "KeyN" &&
      e.ctrlKey &&
      e.altKey &&
      !e.shiftKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      return notesShortcut();
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target instanceof HTMLElement ? e.target : undefined;
    if (
      target?.closest("input, textarea, select, [contenteditable], .notes-panel, .event-panel, .leg-popover") ||
      document.querySelector("dialog[open], .event-panel.expanded")
    )
      return;
    if (e.key === "?") {
      e.preventDefault();
      return setSheetOpen(true);
    }
    const trip = currentTrip;
    if (!trip) return;
    const current =
      selection && "eventId" in selection && selection.tripId === trip.id
        ? allEvents(trip).find((ev) => ev.id === selection.eventId)
        : undefined;
    const handled = () => e.preventDefault();

    if (e.key === "Escape") {
      if (selection) select(undefined);
      return;
    }
    if (e.key in ARROWS) {
      const direction = ARROWS[e.key]!;
      if (!e.shiftKey) {
        const next = neighbour(trip, current?.id, direction);
        if (next) {
          handled();
          if (next.id !== current?.id) selectByKey(trip.id, next.id);
        }
        return;
      }
      // Shift+arrow changes the selected Event: its time (up, down) or its Day (left, right).
      if (!current?.dayId || current.kind === "lodging") return;
      handled();
      if (direction === "up" || direction === "down") {
        const range = axisRange(
          trip.days.flatMap((d) =>
            d.events.filter((ev) => ev.kind !== "lodging"),
          ),
        );
        const { startMinute } = moveEvent(
          current,
          direction === "up" ? -SNAP_MINUTES : SNAP_MINUTES,
          range,
        );
        if (startMinute !== current.startMinute)
          void handleMove(trip.id, current.id, { startMinute });
      } else {
        const dayId = adjacentDayId(
          trip,
          current.dayId,
          direction === "left" ? -1 : 1,
        );
        if (dayId) void handleMove(trip.id, current.id, { dayId });
      }
      return;
    }
    if (e.shiftKey) return;
    // Enter on a focused button keeps its own meaning, except on an Event card.
    if (e.key === "Enter") {
      // Only the selected Event's own card is taken over; other buttons keep their click.
      const own = target?.closest("[data-event-id]")?.getAttribute("data-event-id") === current?.id && !target?.closest(".holding-action");
      if (!current || (target?.closest("button, a, summary") && !own)) return;
      handled();
      return document
        .querySelector<HTMLInputElement>('.event-panel [data-field="title"]')
        ?.focus();
    }
    // Holding a key down must not repeat a create or a delete.
    if (e.repeat && (e.key === "Delete" || e.key === "Backspace" || e.code === "KeyN" || e.code === "KeyB")) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (!current) return;
      handled();
      return void handleDeleteEvent(trip.id, current);
    }
    if (e.code === "KeyN") {
      const dayId =
        current?.dayId ??
        (selection &&
        "draft" in selection &&
        !isHoldingArea(selection.draft.dayId)
          ? selection.draft.dayId
          : trip.days[0]?.id);
      if (!dayId) return;
      handled();
      select({
        tripId: trip.id,
        draft: {
          dayId,
          startMinute: DEFAULT_START_MINUTE,
          durationMinutes: DEFAULT_DURATION_MINUTES,
        },
      });
    } else if (e.code === "KeyB") {
      handled();
      select({
        tripId: trip.id,
        draft: {
          dayId: "backlog",
          startMinute: DEFAULT_START_MINUTE,
          durationMinutes: DEFAULT_DURATION_MINUTES,
        },
      });
    }
  }
  const keyHandler = useRef(handleKey);
  keyHandler.current = handleKey;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      void refreshLegs(tripId);
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
      setSaveError(err instanceof Error ? err.message : t("event.moveFailed"));
      // Legs dropped for the move that failed come back.
      void refreshLegs(tripId);
    }
  }

  const currentTrip = trips && !chooser ? chooseTrip(trips, wantedTripId) : undefined;
  const currentTripId = currentTrip?.id;

  // Live collaboration (ADR 0003): when someone else changes the open Trip, load it again, and light
  // up the Events that differ. Last write wins, so what is loaded simply replaces what was shown.
  const [people, setPeople] = useState<LivePerson[]>([]);
  const [changedIds, setChangedIds] = useState<ReadonlySet<string>>(new Set());
  const refreshes = useRef(0);
  async function refreshTrip(tripId: string) {
    const mine = ++refreshes.current;
    for (let attempt = 0; attempt < 5; attempt++) {
      // A change of this page's own that was on its way while the Trip was loaded may be missing
      // from it, and would be shown undone; try again once those have finished.
      const before = writeActivity();
      let fresh: Trip | undefined;
      try {
        fresh = (await listTrips()).find((trip) => trip.id === tripId);
      } catch {
        return; // The next change or reconnect loads it again.
      }
      if (mine !== refreshes.current) return;
      const after = writeActivity();
      if (before.pending > 0 || after.pending > 0 || before.finished !== after.finished) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (mine !== refreshes.current) return;
        continue;
      }
      const old = tripsRef.current?.find((trip) => trip.id === tripId);
      // What the server says now is what a failed move goes back to, and an older Legs answer is stale.
      legRequests.current++;
      if (fresh) for (const e of allEvents(fresh)) confirmed.current.set(e.id, e);
      const seen = new Map(old ? allEvents(old).map((e) => [e.id, JSON.stringify(e)]) : []);
      const changed = fresh ? allEvents(fresh).filter((e) => seen.get(e.id) !== JSON.stringify(e)).map((e) => e.id) : [];
      setTrips((current) => current && (fresh ? current.map((trip) => (trip.id === tripId ? fresh : trip)) : current.filter((trip) => trip.id !== tripId)));
      if (changed.length > 0 && old) {
        setChangedIds((current) => new Set([...current, ...changed]));
        setTimeout(() => setChangedIds((current) => new Set([...current].filter((id) => !changed.includes(id)))), CHANGE_HIGHLIGHT_MS);
      }
      return;
    }
    // This page kept saving: try again once it is quiet, rather than leave the other person's change unseen.
    if (mine === refreshes.current) setTimeout(() => mine === refreshes.current && void refreshTripRef.current(tripId), 1000);
  }
  const refreshTripRef = useRef(refreshTrip);
  refreshTripRef.current = refreshTrip;
  const liveSession = expired ? undefined : auth.status;
  useEffect(() => {
    setPeople([]);
    if (!currentTripId || !liveSession || liveSession === "loading") return;
    const tripId = currentTripId;
    return openLive(tripId, {
      // The first "ready" follows the Trip just loaded; later ones come after a reconnect.
      onReady: () => void refreshTripRef.current(tripId),
      onChanged: () => void refreshTripRef.current(tripId),
      onPresence: setPeople,
      onDenied: () => void refreshTripRef.current(tripId),
    });
  }, [currentTripId, liveSession]);
  const loaded = trips !== undefined;
  useEffect(() => {
    // Once the Trips are loaded, the URL and this browser follow the Trip shown.
    if (loaded) rememberTripId(currentTripId);
  }, [loaded, currentTripId]);

  // The Trip shown, and its part of the selection.
  const trip = currentTrip;
  const mine = trip && selection?.tripId === trip.id ? selection : undefined;

  const selectedTrip = selection && trips?.find((t) => t.id === selection.tripId);
  const selectedEvent =
    selectedTrip && selection && "eventId" in selection
      ? allEvents(selectedTrip).find((e) => e.id === selection.eventId)
      : undefined;

  const account = <AccountMenu onOpenTripList={() => setTripListOpen(true)} onRelogin={() => void relogin()} />;
  // Under the top bar: Auth0's error, the expired session, and (phone) the guest's way to log in.
  const banners = (
    <>
      <LoginErrorStrip />
      <ExpiredBanner onRelogin={() => void relogin()} />
      {phone && <GuestBanner />}
    </>
  );

  return (
    <>
    <main className={selectedTrip ? "has-panel" : undefined}>
      {!trip && banners}
      {trips?.length === 0 && <TitleForm label={t("app.tripTitle")} submitLabel={t("app.createTrip")} onSubmit={(title) => handleCreateTrip({ title })} />}
      {/* An expired session already has its banner. */}
      {error && !expired && <p role="alert">{error}</p>}
      {saveError && !expired && <p role="alert">{saveError}</p>}
      {trip && (
        <ChangedEventsContext.Provider value={changedIds}>
        <TripIdContext.Provider value={trip.id}>
        <TripCard
          key={trip.id}
          trip={trip}
          account={account}
          collaborators={<Collaborators people={people.filter((person) => person.id !== meId)} />}
          banner={banners}
          sidebar={pinnedList ? tripListView(true) : undefined}
          readOnly={expired}
          onOpenSettings={() => setSettingsTripId(trip.id)}
          onOpenTripList={() => { if (!pinnedList) setTripListOpen(true); }}
          onShare={trip.role === "owner" ? () => (auth.status === "guest" ? void auth.login() : setShareTripId(trip.id)) : undefined}
          onDaysChange={handleDaysChange}
          selectedEventId={mine && "eventId" in mine ? mine.eventId : undefined}
          draft={mine && "draft" in mine ? mine.draft : undefined}
          onMove={(eventId, move) => handleMove(trip.id, eventId, move)}
          onCreateLeg={(input) => handleCreateLeg(trip.id, input)}
          onChangeLegMode={(leg, mode) => handleChangeLegMode(trip.id, leg, mode)}
          onDeleteLeg={(leg) => handleDeleteLeg(trip.id, leg)}
          onToast={setToast}
          notesOpen={notesTripId === trip.id}
          onToggleNotes={() => toggleNotes(trip.id)}
          onShowShortcuts={() => setSheetOpen(true)}
          footer={<Sidebar onShowShortcuts={() => setSheetOpen(true)} />}
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
        </TripIdContext.Provider>
        </ChangedEventsContext.Provider>
      )}
      {trips?.length === 0 && <p>{t("app.noTrips")}</p>}
      {chooser && trips && trips.length > 0 && (
        <section className="choose-trip">
          <MapIcon size={28} aria-hidden="true" />
          <h2>{t("app.chooseTrip")}</h2>
          <p>{t("app.chooseTripHint")}</p>
          <button type="button" className="btn pri" onClick={() => setTripListOpen(true)}>
            {t("tripList.title")}
          </button>
        </section>
      )}
      {!trip && (
        <div className="standalone-switches">
          {!phone && <Sidebar onShowShortcuts={() => setSheetOpen(true)} />}
          {account}
        </div>
      )}
      {selectedTrip && selection && (selectedEvent || "draft" in selection) && (
        <TripIdContext.Provider value={selectedTrip.id}>
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
          apiRef={panelApi}
          onClose={(force) => select(undefined, force)}
          todos={selectedEvent ? selectedTrip.todos.filter((t) => t.eventId === selectedEvent.id) : []}
          onAddTodo={(text, eventId) => handleAddTodo(selectedTrip.id, text, eventId)}
          onToggleTodo={(todo) => handleToggleTodo(selectedTrip.id, todo)}
          onDeleteTodo={(todo) => handleDeleteTodo(selectedTrip.id, todo)}
          onDelete={(event) => handleDeleteEvent(selectedTrip.id, event)}
          startDate={tripStartDate(selectedTrip)}
          onOpenTripSettings={() => setSettingsTripId(selectedTrip.id)}
          onTurnOnOpeningHours={(eventId) => handleTurnOnHours(selectedTrip.id, eventId)}
          onRemoveOpeningHours={(eventId) => handleTurnOffHours(selectedTrip.id, eventId)}
          onChangeImage={(eventId, change) => handleChangeImage(selectedTrip.id, eventId, change)}
          quiet={"eventId" in selection && selection.quiet}
          restored={selection.restored}
          onLoginToSave={expired ? (typed) => relogin(typed) : undefined}
        />
        </TripIdContext.Provider>
      )}
      {notesTripId && trips?.some((t) => t.id === notesTripId) && (
        <NotesPanel
          // Another Trip's Notes start fresh.
          key={notesTripId}
          notes={trips.find((t) => t.id === notesTripId)!.notes}
          onAdd={(body) => handleAddNote(notesTripId, body)}
          onUpdate={(noteId, input) => handleUpdateNote(notesTripId, noteId, input)}
          onDelete={(note) => handleDeleteNote(notesTripId, note)}
          tripId={notesTripId}
          onClose={() => setNotesTripId(undefined)}
          closeRef={closeNotes}
        />
      )}
      {settingsTripId && trips?.some((t) => t.id === settingsTripId) && (
        <TripSettingsDialog
          tripTitle={trips.find((t) => t.id === settingsTripId)!.title}
          startDate={tripStartDate(trips.find((t) => t.id === settingsTripId)!)}
          onChangeStartDate={(startDate) => handleChangeStartDate(settingsTripId, startDate)}
          onClose={() => setSettingsTripId(undefined)}
        />
      )}
      {shareTripId && trips?.some((tr) => tr.id === shareTripId) && (
        <ShareDialog tripId={shareTripId} tripTitle={trips.find((tr) => tr.id === shareTripId)!.title} ownerEmail={auth.email} onClose={() => setShareTripId(undefined)} />
      )}
      {tripListOpen && !pinnedList && tripListView(false)}
      {retryingGeneration && auth.status === "user" && (
        <NewTripDialog
          generation={generation}
          initialStep="ai"
          onCancel={() => setRetryingGeneration(false)}
          onCreate={async (input) => {
            await handleCreateTrip(input);
            setRetryingGeneration(false);
          }}
        />
      )}
      {sheetOpen && <ShortcutSheet onClose={() => setSheetOpen(false)} />}
      {guard.asking && (
        <UnsavedDialog busy={guard.busy} onSave={() => void guard.answer(true)} onDiscard={() => void guard.answer(false)} onKeep={guard.keepEditing} />
      )}
      {removal && (
        <ConfirmDialog
          title={t(removal.action === "archive" ? "removal.archiveTitle" : "removal.deleteTitle", { title: removal.title })}
          confirmLabel={t(removal.action === "archive" ? "removal.archiveConfirm" : "removal.deleteConfirm")}
          tone={removal.action === "archive" ? "primary" : "danger"}
          reminderOption
          onConfirm={(skip) => answerRemoval(true, skip)}
          onCancel={() => answerRemoval(false)}
        >
          <p>
            <strong>{t("count.todo", { count: removal.summary.count })}</strong>
            {removal.summary.byOthers > 0
              ? t("removal.restOthers", { others: removal.summary.byOthers })
              : t("removal.rest")}
          </p>
          <ul>
            {removal.action === "archive" ? (
              <>
                <li>{t("removal.archiveNote1")}</li>
                <li>{t("removal.archiveNote2")}</li>
              </>
            ) : (
              <li>{t("removal.deleteNote")}</li>
            )}
          </ul>
        </ConfirmDialog>
      )}
      {toast && <Toast key={toast.id} message={toast.message} actionLabel={toast.undo ? (toast.actionLabel ?? t("generic.undo")) : undefined} onAction={toast.undo} onDismiss={dismissToast} />}
    </main>
    </>
  );
}
