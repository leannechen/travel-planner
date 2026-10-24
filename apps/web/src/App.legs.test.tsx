// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Event, Leg } from "@travel-planner/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { listLegs, listTrips, updateEvent } from "./api";
import { makeDay, makeEvent, makeTrip, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listTrips: vi.fn(),
  getMe: vi.fn(async () => ({ id: "me" })),
  listLegs: vi.fn(),
  getOpeningHours: vi.fn(async () => ({})),
  getPlaces: vi.fn(async () => []),
  updateEvent: vi.fn(),
}));

const nishiki = makeEvent({ title: "Nishiki Market", holding: null, startMinute: 660, durationMinutes: 90, placeId: "p1" });
const kiyomizu = makeEvent({ title: "Kiyomizu-dera", holding: null, startMinute: 810, durationMinutes: 90, placeId: "p2" });
const day = makeDay(1, [nishiki, kiyomizu]);
const leg = (manual: boolean): Leg => ({ id: "00000000-0000-4000-8000-0000000000aa", dayId: day.id, fromEventId: nishiki.id, toEventId: kiyomizu.id, mode: "transit", durationMinutes: 25, distanceMeters: manual ? null : 9000, manual });

beforeEach(() => {
  setPhone(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  window.history.replaceState(null, "", "/trip/current");
  localStorage.clear();
  vi.mocked(updateEvent).mockImplementation(async (_tripId, id, input) => ({ ...day.events.find((e) => e.id === id)!, ...input }) as Event);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function open(manual: boolean) {
  const trip = makeTrip({ title: "Kyoto", days: [day], legs: [leg(manual)] });
  vi.mocked(listTrips).mockResolvedValue([trip]);
  vi.mocked(listLegs).mockResolvedValue([leg(manual)]);
  renderApp(<App />);
}

async function saveInPanel(change: (panel: HTMLElement) => void) {
  await userEvent.click(await screen.findByRole("button", { name: /Kiyomizu-dera/ }));
  const panel = (await screen.findByRole("textbox", { name: "Title" })).closest("form")!;
  change(panel);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(updateEvent).toHaveBeenCalled());
}

const startField = () => screen.getByLabelText("Start") as HTMLInputElement;

describe("a Leg with a duration entered by hand", () => {
  it("is pointed out when an Event next to it changes its time", async () => {
    open(true);
    await saveInPanel(() => fireEvent.change(startField(), { target: { value: "13:45" } }));
    expect(await screen.findByText("The time of this Travel was entered by hand; check it.")).toBeTruthy();
  });

  it("is not pointed out when something else about the Event changes", async () => {
    open(true);
    await saveInPanel(() => fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Kiyomizu" } }));
    expect(screen.queryByText("The time of this Travel was entered by hand; check it.")).toBeNull();
  });

  it("is not pointed out for a calculated Leg", async () => {
    open(false);
    await saveInPanel(() => fireEvent.change(startField(), { target: { value: "13:45" } }));
    expect(screen.queryByText("The time of this Travel was entered by hand; check it.")).toBeNull();
  });
});
