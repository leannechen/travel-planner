// @vitest-environment jsdom
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { listTrips } from "./api";
import { createFakeAuth } from "./fakeAuth";
import { forgetGuestId } from "./guest";
import { setLiveSocketFactory } from "./live";
import { makeDay, makeEvent, makeTrip, memoryStore, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listTrips: vi.fn(),
  getMe: vi.fn(async () => ({ id: "me", guest: false })),
  listLegs: vi.fn(async () => []),
  getOpeningHours: vi.fn(async () => ({})),
  getPlaces: vi.fn(async () => []),
}));

// The connection to the API, driven by the test.
class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  tell(message: object) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }
}

const event = makeEvent({ title: "Fushimi Inari", startMinute: 600 });
const trip = makeTrip({ title: "Kyoto", days: [makeDay(1, [event]), makeDay(2)] });

beforeEach(() => {
  setPhone(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  FakeSocket.all = [];
  setLiveSocketFactory((url) => new FakeSocket(url) as never);
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  sessionStorage.clear();
  forgetGuestId();
  vi.mocked(listTrips).mockResolvedValue([trip]);
});
afterEach(() => {
  cleanup();
  setLiveSocketFactory(undefined);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function openTrip() {
  renderApp(<App />, createFakeAuth({ store: memoryStore(), navigate: () => undefined }));
  await screen.findByText("Fushimi Inari");
  await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
  const socket = FakeSocket.all[0]!;
  act(() => socket.onopen?.());
  return socket;
}

describe("live collaboration in the workspace", () => {
  it("says who this page is when it connects, for the open Trip", async () => {
    const socket = await openTrip();

    expect(socket.url).toMatch(/\/api\/live$/);
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: "hello", tripId: trip.id, guest: expect.any(String) });
  });

  it("shows the others who have the Trip open, not this user", async () => {
    const socket = await openTrip();

    socket.tell({ type: "presence", people: [{ id: "me", initial: "L" }, { id: "mei", initial: "M" }] });

    expect(await screen.findByRole("listitem", { name: "M" })).toBeTruthy();
    expect(screen.queryByRole("listitem", { name: "L" })).toBeNull();
  });

  it("loads the Trip again when someone else changes it, and lights up the Event that changed", async () => {
    const socket = await openTrip();
    socket.tell({ type: "ready" });
    await waitFor(() => expect(listTrips).toHaveBeenCalledTimes(2));
    const changed = { ...event, title: "Fushimi Inari Taisha" };
    vi.mocked(listTrips).mockResolvedValue([{ ...trip, days: [makeDayWith(trip, changed), trip.days[1]!] }]);

    socket.tell({ type: "changed", origin: "someone-else" });

    const card = (await screen.findByText("Fushimi Inari Taisha")).closest("li");
    expect(card?.className).toContain("changed");
    expect(screen.queryByText("Fushimi Inari")).toBeNull();
  });

  it("ignores a change that this page made itself", async () => {
    const { clientId } = await import("./api");
    const socket = await openTrip();

    socket.tell({ type: "changed", origin: clientId });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(listTrips).toHaveBeenCalledTimes(1);
  });

  it("does not light up Events that did not change", async () => {
    const socket = await openTrip();
    vi.mocked(listTrips).mockResolvedValue([{ ...trip, todos: [{ id: "00000000-0000-4000-8000-0000000000aa", eventId: null, text: "Buy ICOCA", done: false, createdBy: "mei" }] }]);

    socket.tell({ type: "changed", origin: "someone-else" });

    await waitFor(() => expect(listTrips).toHaveBeenCalledTimes(2));
    await screen.findByText("Buy ICOCA");
    expect(document.querySelector(".event-card.changed")).toBeNull();
  });

  it("drops a Trip the user may no longer open", async () => {
    const other = makeTrip({ title: "Osaka" });
    vi.mocked(listTrips).mockResolvedValue([trip, other]);
    const socket = await openTrip();
    vi.mocked(listTrips).mockResolvedValue([other]);

    act(() => socket.onclose?.({ code: 4403 }));

    expect(await screen.findByRole("button", { name: /Osaka/ })).toBeTruthy();
    expect(FakeSocket.all).toHaveLength(2);
  });
});

function makeDayWith(source: typeof trip, changed: typeof event) {
  const day = source.days[0]!;
  return { ...day, events: day.events.map((e) => (e.id === changed.id ? { ...changed, dayId: day.id, holding: null } : e)) };
}
