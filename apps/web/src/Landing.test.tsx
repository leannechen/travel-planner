// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { listTrips } from "./api";
import { createFakeAuth } from "./fakeAuth";
import { forgetGuestId } from "./guest";
import { makeTrip, memoryStore, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listTrips: vi.fn(async () => [makeTrip({ title: "Kyoto" })]),
  getMe: vi.fn(async () => ({ id: "me", guest: true })),
  listLegs: vi.fn(async () => []),
  getOpeningHours: vi.fn(async () => ({})),
  getPlaces: vi.fn(async () => []),
}));

beforeEach(() => {
  setPhone(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  forgetGuestId();
  window.history.replaceState(null, "", "/?loggedout=1");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("after Log out", () => {
  it("shows the Landing page with the toast, and asks the server for nothing", async () => {
    renderApp(<App />, createFakeAuth({ store: memoryStore(), navigate: () => undefined }));
    expect(screen.getByText("You're logged out")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start planning" })).toBeTruthy();
    expect(listTrips).not.toHaveBeenCalled();
  });

  it("Log in goes to the login page and returns to the start page, not to the logged-out page", async () => {
    const auth = createFakeAuth({ store: memoryStore(), navigate: () => undefined });
    const login = vi.spyOn(auth, "loginRedirect");
    renderApp(<App />, auth);
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ returnTo: "/", language: "en" }));
  });

  it("Start planning opens the workspace as a guest", async () => {
    renderApp(<App />, createFakeAuth({ store: memoryStore(), navigate: () => undefined }));
    await userEvent.click(screen.getByRole("button", { name: "Start planning" }));
    expect(await screen.findByRole("button", { name: "Log in to save your progress" })).toBeTruthy();
    expect(window.location.search).not.toContain("loggedout");
  });
});
