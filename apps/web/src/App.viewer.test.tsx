// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ApiError, getSharedTrip } from "./api";
import { createFakeAuth } from "./fakeAuth";
import { forgetGuestId } from "./guest";
import { setLiveSocketFactory } from "./live";
import { makeDay, makeEvent, makeTrip, memoryStore, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  getSharedTrip: vi.fn(),
  listTrips: vi.fn(async () => []),
  getMe: vi.fn(async () => ({ id: "me", guest: false })),
  listLegs: vi.fn(async () => []),
  getOpeningHours: vi.fn(async () => new Map()),
  getPlaces: vi.fn(async () => []),
}));

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
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
  close() {}
  tell(message: object) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }
}

const sights = makeEvent({ title: "Kiyomizu-dera", dayId: null, holding: null, description: "Buy the timed ticket online.", phone: "+81 75-551-1234", startMinute: 900, durationMinutes: 120 });
const day = makeDay(1, [sights]);
const trip = makeTrip({
  title: "Kyoto & Osaka",
  role: "viewer",
  days: [day],
  backlog: [makeEvent({ title: "Nishiki Market", kind: "meal" })],
});

beforeEach(() => {
  setPhone(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  FakeSocket.all = [];
  setLiveSocketFactory((url) => new FakeSocket(url) as never);
  window.history.replaceState(null, "", "/t/k7Qx2mAbCdEf");
  localStorage.clear();
  sessionStorage.clear();
  forgetGuestId();
  vi.mocked(getSharedTrip).mockResolvedValue(trip);
});
afterEach(() => {
  cleanup();
  setLiveSocketFactory(undefined);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const open = () => renderApp(<App />, createFakeAuth({ store: memoryStore(), navigate: () => undefined }));

describe("a share link, opened without logging in", () => {
  it("shows the Days and the Backlog read-only, with a Log in button", async () => {
    open();

    expect(await screen.findByText("Kiyomizu-dera")).toBeTruthy();
    expect(getSharedTrip).toHaveBeenCalledWith("k7Qx2mAbCdEf");
    expect(screen.getByText("Nishiki Market")).toBeTruthy();
    expect(screen.getByText("Viewing · read only")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("has no Notes, Share, Trip settings, Archive, Todos or Day and Event editing", async () => {
    open();
    await screen.findByText("Kiyomizu-dera");

    for (const name of [/^Notes/, "Share", "Trip settings", "Move earlier", "Move later", "Delete Day", "Add Event", "Add to Backlog"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("heading", { name: /^Archive/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Todos/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Insert/ })).toBeNull();
  });

  it("opens an Event as plain text with its description and contact, and closes it", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Kiyomizu-dera/ }));

    const panel = await screen.findByRole("complementary", { name: "Event" });
    expect(within(panel).getByRole("heading", { name: "Kiyomizu-dera" })).toBeTruthy();
    expect(within(panel).getByText("Buy the timed ticket online.")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "+81 75-551-1234" })).toBeTruthy();
    expect(within(panel).queryByRole("textbox")).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Save" })).toBeNull();

    await userEvent.click(within(panel).getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("complementary", { name: "Event" })).toBeNull();
  });

  it("closes the Event with Esc", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Kiyomizu-dera/ }));
    await screen.findByRole("complementary", { name: "Event" });

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("complementary", { name: "Event" })).toBeNull();
  });

  it("opens a Backlog Event too", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Nishiki Market/ }));

    const panel = await screen.findByRole("complementary", { name: "Event" });
    expect(within(panel).getByRole("heading", { name: "Nishiki Market" })).toBeTruthy();
    expect(within(panel).getByText("Backlog")).toBeTruthy();
  });

  it("connects with the link, and loads the Trip again when it changes", async () => {
    open();
    await screen.findByText("Kiyomizu-dera");
    await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    act(() => FakeSocket.all[0]!.onopen?.());
    expect(JSON.parse(FakeSocket.all[0]!.sent[0]!)).toMatchObject({ type: "hello", tripId: trip.id, share: "k7Qx2mAbCdEf" });
    expect(JSON.parse(FakeSocket.all[0]!.sent[0]!).token).toBeUndefined();
    vi.mocked(getSharedTrip).mockResolvedValue({ ...trip, backlog: [makeEvent({ title: "Gion walk" })] });

    FakeSocket.all[0]!.tell({ type: "changed", origin: "someone" });

    expect(await screen.findByText("Gion walk")).toBeTruthy();
    expect(screen.queryByText("Nishiki Market")).toBeNull();
  });

  it("says so when the Owner turns the link off while it is open", async () => {
    open();
    await screen.findByText("Kiyomizu-dera");
    await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    vi.mocked(getSharedTrip).mockRejectedValue(new ApiError("This link is turned off", "link_off"));

    act(() => FakeSocket.all[0]!.onclose?.({ code: 4403 }));

    expect(await screen.findByRole("heading", { name: "This link is turned off" })).toBeTruthy();
  });
});

describe("a share link that does not work", () => {
  it("says the link is turned off", async () => {
    vi.mocked(getSharedTrip).mockRejectedValue(new ApiError("off", "link_off"));
    open();

    expect(await screen.findByRole("heading", { name: "This link is turned off" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Travel Planner" })).toBeTruthy();
  });

  it("says the link leads nowhere", async () => {
    vi.mocked(getSharedTrip).mockRejectedValue(new ApiError("none", "link_not_found"));
    open();

    expect(await screen.findByRole("heading", { name: "This link doesn't lead to a Trip" })).toBeTruthy();
  });

  it("says when the Trip could not be loaded", async () => {
    vi.mocked(getSharedTrip).mockRejectedValue(new Error("network"));
    open();

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
