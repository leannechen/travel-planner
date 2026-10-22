// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { getEventImage, getSharedTrip } from "./api";
import { createFakeAuth } from "./fakeAuth";
import { forgetGuestId } from "./guest";
import { setLiveSocketFactory } from "./live";
import { makeDay, makeEvent, makeTrip, memoryStore, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  getSharedTrip: vi.fn(),
  getEventImage: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
  listTrips: vi.fn(async () => []),
  getMe: vi.fn(async () => ({ id: "me", guest: false })),
  listLegs: vi.fn(async () => []),
  getOpeningHours: vi.fn(async () => new Map()),
  getPlaces: vi.fn(async () => []),
}));

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send() {}
  close() {}
}

const IMAGE_ID = "00000000-0000-4000-8000-0000000000cc";
const tall = makeEvent({ title: "Kiyomizu-dera", dayId: null, holding: null, startMinute: 900, durationMinutes: 120, imageId: IMAGE_ID });
const short = makeEvent({ title: "Coffee stop", dayId: null, holding: null, startMinute: 600, durationMinutes: 30, imageId: IMAGE_ID });
const trip = makeTrip({ title: "Kyoto", role: "viewer", days: [makeDay(1, [short, tall])] });

beforeEach(() => {
  setPhone(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  setLiveSocketFactory((url) => new FakeSocket(url) as never);
  window.history.replaceState(null, "", "/t/k7Qx2mAbCdEf");
  localStorage.clear();
  sessionStorage.clear();
  forgetGuestId();
  URL.createObjectURL = vi.fn(() => "blob:event-image");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(getSharedTrip).mockResolvedValue(trip);
});
afterEach(() => {
  cleanup();
  setLiveSocketFactory(undefined);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const open = () => renderApp(<App />, createFakeAuth({ store: memoryStore(), navigate: () => undefined }));

describe("an Event image seen by a Viewer", () => {
  it("shows a thumbnail on a tall card only", async () => {
    open();
    const tallCard = (await screen.findByText("Kiyomizu-dera")).closest("li")!;
    const shortCard = screen.getByText("Coffee stop").closest("li")!;

    expect(await within(tallCard).findByRole("presentation", { hidden: true })).toBeTruthy();
    expect(within(shortCard).queryByRole("presentation", { hidden: true })).toBeNull();
    // The Viewer reads it through the share link, not as a logged-in request.
    expect(getEventImage).toHaveBeenCalledWith(trip.id, tall.id);
  });

  it("shows the image in the Event details, and opens it large and closes it again", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByText("Kiyomizu-dera"));

    const details = await screen.findByRole("complementary", { name: "Event" });
    const preview = await within(details).findByRole("button", { name: "Show the image larger" });
    expect(within(preview).getByRole("img", { name: "Kiyomizu-dera" })).toBeTruthy();

    await user.click(preview);
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Esc closes the picture first, not the details behind it.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Event" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Event" })).toBeNull();
  });

  it("shows no picture for an Event without an image", async () => {
    vi.mocked(getSharedTrip).mockResolvedValue(makeTrip({ title: "Kyoto", role: "viewer", days: [makeDay(1, [makeEvent({ title: "Plain", dayId: null, holding: null, startMinute: 900, durationMinutes: 120 })])] }));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByText("Plain"));

    await screen.findByRole("complementary", { name: "Event" });
    expect(screen.queryByRole("button", { name: "Show the image larger" })).toBeNull();
    expect(getEventImage).not.toHaveBeenCalled();
  });
});
