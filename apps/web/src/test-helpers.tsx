import type { Day, Event, Trip } from "@travel-planner/shared";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
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

export const renderApp = (ui: ReactElement) => render(<PreferencesProvider>{ui}</PreferencesProvider>);

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
    ...overrides,
  };
}

export const makeDay = (position: number, events: Event[] = []): Day => {
  const dayId = id();
  return { id: dayId, position, events: events.map((e) => ({ ...e, dayId: e.dayId ?? dayId, holding: null })) };
};

export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return { id: id(), title: "Kyoto", days: [makeDay(1), makeDay(2)], backlog: [], archive: [], todos: [], notes: [], legs: [], travelMode: "transit", ...overrides };
}
