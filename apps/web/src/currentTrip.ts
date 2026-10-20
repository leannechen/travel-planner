// Which Trip the page shows, and in which view. The choice lives in the URL (`?trip=<id>`) so a reload and a shared
// link show the same Trip, and in this browser as a fallback for a visit without the parameter.
const KEY = "travel-planner.current-trip";
const PARAM = "trip";

// The Trip to show: the wanted one if it exists, else the first, else none.
export function chooseTrip<T extends { id: string }>(trips: T[], wantedId: string | undefined): T | undefined {
  return trips.find((trip) => trip.id === wantedId) ?? trips[0];
}

export function readWantedTripId(): string | undefined {
  const fromUrl = new URLSearchParams(window.location.search).get(PARAM);
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberTripId(id: string | undefined) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(PARAM) === (id ?? null)) return rememberInBrowser(id);
  if (id) url.searchParams.set(PARAM, id);
  else url.searchParams.delete(PARAM);
  window.history.replaceState(window.history.state, "", url);
  rememberInBrowser(id);
}

function rememberInBrowser(id: string | undefined) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Without storage the URL still keeps the choice.
  }
}

// The view of the Trip (`?view=schedule|map`) lives in the URL only, so switching Trips keeps it.
// `rememberTripId` leaves other parameters alone.
export type TripView = "schedule" | "map";
const VIEW_PARAM = "view";

export function readView(): TripView {
  return new URLSearchParams(window.location.search).get(VIEW_PARAM) === "map" ? "map" : "schedule";
}

export function rememberView(view: TripView) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(VIEW_PARAM) === view) return;
  url.searchParams.set(VIEW_PARAM, view);
  window.history.replaceState(window.history.state, "", url);
}
