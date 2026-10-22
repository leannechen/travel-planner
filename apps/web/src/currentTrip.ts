// Which Trip the page shows. A Trip has its own address, `/trip/<id>`, so a reload and a link show
// the same Trip; this browser also remembers the last one, for a visit without an address and for
// "Continue" on the Landing page. The older `/?trip=<id>` is still understood.
const KEY = "travel-planner.current-trip";
const PARAM = "trip";
// `/?trips=1` opens the workspace with the Trip list open (from the share-link page's "My Trips").
const TRIPS_PARAM = "trips";
export const tripListAddress = `/?${TRIPS_PARAM}=1`;
export const wantsTripList = () => new URLSearchParams(window.location.search).has(TRIPS_PARAM);

export const tripPath = (id: string) => `/trip/${encodeURIComponent(id)}`;

const TRIP_PATH = /^\/trip\/([^/]+)\/?$/;

// The Trip id in an address like `/trip/<id>`.
export function tripIdOfPath(pathname: string): string | undefined {
  const raw = TRIP_PATH.exec(pathname)?.[1];
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

// The Trip to show: the wanted one if it exists, else the first, else none.
export function chooseTrip<T extends { id: string }>(trips: T[], wantedId: string | undefined): T | undefined {
  return trips.find((trip) => trip.id === wantedId) ?? trips[0];
}

// The id kept in this browser: the Trip opened last.
export function readRememberedTripId(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

// The address first, then the older `?trip=`, then the Trip opened last in this browser.
export function readWantedTripId(): string | undefined {
  return tripIdOfPath(window.location.pathname) ?? new URLSearchParams(window.location.search).get(PARAM) ?? readRememberedTripId();
}

// Whether the address is the Landing page: the root, without a Trip, an invitation or the answer
// of the login page in it.
export function isLandingLocation(location: Pick<Location, "pathname" | "search"> = window.location): boolean {
  if (location.pathname !== "/") return false;
  const params = new URLSearchParams(location.search);
  // `trips` asks the workspace to open the Trip list. The login page answers with a code, or with an
  // error, and the state it was given.
  const loginAnswer = params.has("state") && (params.has("code") || params.has("error"));
  return !params.has(PARAM) && !params.has("invite") && !params.has(TRIPS_PARAM) && !loginAnswer;
}

// Whether the address names a Trip, in either form.
export function hasTripInAddress(): boolean {
  return tripIdOfPath(window.location.pathname) !== undefined || new URLSearchParams(window.location.search).has(PARAM);
}

// Puts the Trip in the address (replacing the entry, so Back does not step through every Trip the
// user switched to) and in this browser. Other parameters, such as the view, stay.
export function rememberTripId(id: string | undefined) {
  const url = new URL(window.location.href);
  // Without a Trip the address goes back to the root, so a reload shows the Landing page.
  const wantedPath = id ? tripPath(id) : tripIdOfPath(url.pathname) ? "/" : url.pathname;
  if (url.pathname !== wantedPath || url.searchParams.has(PARAM) || url.searchParams.has(TRIPS_PARAM)) {
    url.pathname = wantedPath;
    url.searchParams.delete(PARAM);
    // Asked for once (read when the page opened), not kept.
    url.searchParams.delete(TRIPS_PARAM);
    window.history.replaceState(window.history.state, "", url);
  }
  rememberInBrowser(id);
}

// Goes to a Trip from another page (the Landing page), as a new history entry so Back returns.
export function openTrip(id: string) {
  const url = new URL(window.location.href);
  url.pathname = tripPath(id);
  url.search = "";
  window.history.pushState(null, "", url);
  rememberInBrowser(id);
}

function rememberInBrowser(id: string | undefined) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Without storage the address still keeps the choice.
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
