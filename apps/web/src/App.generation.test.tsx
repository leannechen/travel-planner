// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { getGeneration, getGenerations, listTrips } from "./api";
import { createFakeAuth } from "./fakeAuth";
import { makeDay, makeEvent, makeTrip, memoryStore, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listTrips: vi.fn(),
  getMe: vi.fn(async () => ({ id: "me", guest: false })),
  listLegs: vi.fn(async () => []),
  getOpeningHours: vi.fn(async () => ({})),
  getPlaces: vi.fn(async () => []),
  getGenerations: vi.fn(),
  getGeneration: vi.fn(),
}));

const kyoto = makeTrip({ title: "Kyoto", days: [makeDay(1, [makeEvent({ title: "Fushimi Inari" })])] });
const generated = makeTrip({ title: "3 days in Nara", days: [makeDay(1, [makeEvent({ title: "Todai-ji" })])] });
const running = { id: "11111111-1111-4111-8111-111111111111", status: "running" as const, tripId: null, failure: null };

// A logged-in user (AI generation is for accounts only).
const loggedIn = () => {
  const store = memoryStore();
  store.setItem("travel-planner.fake-auth", JSON.stringify({ email: "lena@example.com" }));
  return createFakeAuth({ store, navigate: () => undefined });
};

beforeEach(() => {
  setPhone(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(listTrips).mockResolvedValue([kyoto]);
  // A generation started before the page was opened is running.
  vi.mocked(getGenerations).mockResolvedValueOnce({ remaining: 2, running }).mockResolvedValue({ remaining: 2, running: null });
  window.history.replaceState(null, "", "/trip/current");
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("an AI generation that finishes while the dialog is closed", () => {
  it("says the Trip is ready, and Open shows it", async () => {
    vi.mocked(getGeneration).mockResolvedValue({ ...running, status: "done", tripId: generated.id });
    renderApp(<App />, loggedIn());
    await screen.findByText("Fushimi Inari");
    vi.mocked(listTrips).mockResolvedValue([kyoto, generated]);

    const toast = await screen.findByText("“3 days in Nara” is ready", undefined, { timeout: 4000 });
    expect(toast).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Todai-ji")).toBeTruthy();
  });

  it("offers to try again with the same dialog when it failed", async () => {
    vi.mocked(getGeneration).mockResolvedValue({ ...running, status: "failed", failure: "failed" });
    renderApp(<App />, loggedIn());
    await screen.findByText("Fushimi Inari");

    await screen.findByText("Your Trip could not be created with AI.", undefined, { timeout: 4000 });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("heading", { name: "Generate with AI" })).toBeTruthy();
  });
});
