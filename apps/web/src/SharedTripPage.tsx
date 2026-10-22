import { type Trip } from "@travel-planner/shared";
import { LogIn, Map as MapIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountMenu } from "./AccountMenu";
import { ApiError, getSharedTrip, listTrips, setSharedLink } from "./api";
import { useAuth } from "./AuthProvider";
import { EventDetails } from "./EventDetails";
import { TripIdContext } from "./eventImage";
import { openLive } from "./live";
import { ChangedEventsContext } from "./liveContext";
import { useIsPhone } from "./phone";
import { useT } from "./preferences";
import { ShortcutSheet } from "./ShortcutSheet";
import { Sidebar } from "./Sidebar";
import { allEvents } from "@travel-planner/shared";
import { tripStartDate } from "./tripDates";
import { TripCard } from "./TripCard";

type State = { kind: "loading" } | { kind: "trip"; trip: Trip } | { kind: "off" } | { kind: "missing" } | { kind: "error" };

const NO_EVENTS: ReadonlySet<string> = new Set();
const noop = () => undefined;
const noopAsync = async () => undefined;

// The address of a Trip's share link: /t/<secret>.
export const sharedTokenOf = (pathname: string) => /^\/t\/([\w-]{1,200})\/?$/.exec(pathname)?.[1];

// What a Viewer sees at /t/<secret> (PRD §8, design 18): the Trip read-only, with no login. Changes
// by the Owner and Editors arrive as they happen; when the Owner turns the link off, the page says so.
export function SharedTripPage({ token }: { token: string }) {
  const t = useT();
  const auth = useAuth();
  const phone = useIsPhone();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Place lookups of this page go through the link, which needs no login.
  useEffect(() => {
    setSharedLink(token);
    return () => setSharedLink(undefined);
  }, [token]);

  // Only the newest answer counts: a slower, older one must not undo what a later load showed.
  const loads = useRef(0);
  const load = useCallback(async () => {
    const mine = ++loads.current;
    try {
      const trip = await getSharedTrip(token);
      if (mine === loads.current) setState({ kind: "trip", trip });
    } catch (err) {
      if (mine !== loads.current) return;
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === "link_off") setState({ kind: "off" });
      else if (code === "link_not_found") setState({ kind: "missing" });
      // A failed refresh keeps what is on screen.
      else setState((current) => (current.kind === "trip" ? current : { kind: "error" }));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const tripId = state.kind === "trip" ? state.trip.id : undefined;
  useEffect(() => {
    if (!tripId) return;
    return openLive(tripId, { onReady: () => void load(), onChanged: () => void load(), onPresence: noop, onDenied: () => void load() }, token);
  }, [tripId, token, load]);

  // Someone who can edit this Trip is better off in the workspace.
  const loggedIn = auth.status === "user";
  useEffect(() => {
    if (!loggedIn || !tripId) return;
    let current = true;
    listTrips().then(
      (trips) => current && trips.some((trip) => trip.id === tripId) && window.location.replace(`/?trip=${encodeURIComponent(tripId)}`),
      noop,
    );
    return () => {
      current = false;
    };
  }, [loggedIn, tripId]);

  const closeDetails = useCallback(() => setSelectedId(undefined), []);
  // The Event that was open may be gone after a change.
  const trip = state.kind === "trip" ? state.trip : undefined;
  const selected = trip && selectedId ? allEvents(trip).find((e) => e.id === selectedId) : undefined;

  const account =
    auth.status === "user" ? (
      <AccountMenu onOpenTripList={() => window.location.assign("/")} onRelogin={noop} />
    ) : auth.status === "loading" ? (
      <span className="account-spot loading" role="status" aria-label={t("account.loading")} aria-busy="true" />
    ) : (
      <button type="button" className={phone ? "btn pri account-login icon" : "btn pri account-login"} aria-label={t("account.login")} onClick={() => void auth.login()}>
        <LogIn size={16} aria-hidden="true" />
        {!phone && t("account.login")}
      </button>
    );

  if (!trip) {
    const message =
      state.kind === "off"
        ? ([t("viewer.offTitle"), t("viewer.offBody")] as const)
        : state.kind === "missing"
          ? ([t("viewer.notFoundTitle"), t("viewer.notFoundBody")] as const)
          : undefined;
    return (
      <main className="viewer-state">
        <div className="standalone-switches">
          {!phone && <Sidebar onShowShortcuts={() => setSheetOpen(true)} />}
          {account}
        </div>
        {state.kind === "loading" && <p role="status">{t("viewer.loading")}</p>}
        {state.kind === "error" && <p role="alert">{t("viewer.error")}</p>}
        {message && (
          <section className="choose-trip">
            <MapIcon size={28} aria-hidden="true" />
            <h1>{message[0]}</h1>
            <p>{message[1]}</p>
            <a className="btn pri" href="/">
              {t("viewer.home")}
            </a>
          </section>
        )}
        {sheetOpen && <ShortcutSheet onClose={() => setSheetOpen(false)} />}
      </main>
    );
  }

  return (
    <main className={selected ? "has-panel" : undefined}>
      <TripIdContext.Provider value={trip.id}>
      <ChangedEventsContext.Provider value={NO_EVENTS}>
        <TripCard
          key={trip.id}
          trip={trip}
          viewer
          account={account}
          onOpenSettings={noop}
          onDaysChange={noop}
          selectedEventId={selected?.id}
          onSelectEvent={setSelectedId}
          onCreateAt={noop}
          onAddToBacklog={noop}
          onMove={noop}
          onCreateLeg={() => Promise.reject(new Error("read only"))}
          onChangeLegMode={noopAsync}
          onDeleteLeg={noopAsync}
          onToast={noop}
          notesOpen={false}
          onToggleNotes={noop}
          onShowShortcuts={() => setSheetOpen(true)}
          footer={
            <>
              <p className="viewer-note">{t("viewer.noArchive")}</p>
              {!phone && <Sidebar onShowShortcuts={() => setSheetOpen(true)} />}
            </>
          }
          onAddTodo={noopAsync}
          onToggleTodo={noop}
          onDeleteTodo={noop}
        />
      </ChangedEventsContext.Provider>
      {selected && <EventDetails key={selected.id} event={selected} days={trip.days} startDate={tripStartDate(trip)} onClose={closeDetails} />}
      </TripIdContext.Provider>
      {sheetOpen && <ShortcutSheet onClose={() => setSheetOpen(false)} />}
    </main>
  );
}
