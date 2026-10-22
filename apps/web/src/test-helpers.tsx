import type { Day, Event, Trip } from "@travel-planner/shared";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import type { AuthClient } from "./authClient";
import { createFakeAuth } from "./fakeAuth";
import { PreferencesProvider } from "./preferences";

// jsdom has no media queries: pretend the window is a phone, or not.
export function setPhone(phone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: phone,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  );
}

// A storage that lives only for the test, so a fake login does not leak into the next one.
export function memoryStore() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

// The app with the preferences and a fake sign-in (a guest, unless the test passes a client that is logged in).
export const renderApp = (ui: ReactElement, auth: AuthClient = createFakeAuth({ store: memoryStore(), navigate: () => undefined })) =>
  render(
    <PreferencesProvider>
      <AuthProvider client={auth}>{ui}</AuthProvider>
    </PreferencesProvider>,
  );

let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

export function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: id(),
    dayId: null,
    holding: "backlog",
    kind: "attraction",
    title: "Fushimi Inari",
    startMinute: 600,
    durationMinutes: 120,
    transportLabel: null,
    nights: null,
    checkInMinute: null,
    checkOutMinute: null,
    description: null,
    phone: null,
    email: null,
    website: null,
    bookingUrl: null,
    placeId: null,
    destinationId: null,
    openingHoursOn: false,
    imageId: null,
    ...overrides,
  };
}

export const makeDay = (position: number, events: Event[] = []): Day => {
  const dayId = id();
  return { id: dayId, position, events: events.map((e) => ({ ...e, dayId: e.dayId ?? dayId, holding: null })) };
};

export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return { id: id(), title: "Kyoto", days: [makeDay(1), makeDay(2)], backlog: [], archive: [], todos: [], notes: [], legs: [], travelMode: "transit", startDate: null, role: "owner", ...overrides };
}
