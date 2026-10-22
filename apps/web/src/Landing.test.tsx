// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { listTrips, openSampleTrip } from "./api";
import { authHooks } from "./apiAuth";
import type { AuthClient } from "./authClient";
import { createFakeAuth, type FakeAuth } from "./fakeAuth";
import { forgetGuestId, guestId } from "./guest";
import { makeDay, makeEvent, makeTrip, memoryStore, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listTrips: vi.fn(),
  openSampleTrip: vi.fn(),
  getMe: vi.fn(async () => ({ id: "me", guest: true })),
  listLegs: vi.fn(async () => []),
  getOpeningHours: vi.fn(async () => ({})),
  getPlaces: vi.fn(async () => []),
}));

const kyoto = makeTrip({ title: "Kyoto", days: [makeDay(1, [makeEvent({ title: "Fushimi Inari" })])] });
const taipei = makeTrip({ title: "Taipei", days: [makeDay(1, [makeEvent({ title: "Din Tai Fung" })])] });

let fake: FakeAuth;

beforeEach(() => {
  setPhone(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  forgetGuestId();
  window.history.replaceState(null, "", "/");
  vi.mocked(listTrips).mockResolvedValue([kyoto]);
  vi.mocked(openSampleTrip).mockResolvedValue({ tripId: kyoto.id, created: true });
  fake = createFakeAuth({ store: memoryStore(), navigate: () => undefined });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function loggedIn(): Promise<AuthClient> {
  const user = await fake.loginPopup({ language: "en" });
  return { ...fake, start: async () => ({ user, returned: false, error: false }) };
}

describe("a new visitor", () => {
  it("sees the Landing page at the root, with the sample Trip as the one action, and the server is not asked", async () => {
    renderApp(<App />, fake);
    expect(await screen.findByRole("button", { name: "Open a sample Trip" })).toBeTruthy();
    expect(screen.getByText("Free to try · no login needed")).toBeTruthy();
    expect(screen.getByText("No login needed. You get an editable copy.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(listTrips).not.toHaveBeenCalled();
    expect(openSampleTrip).not.toHaveBeenCalled();
  });

  it("opens the sample Trip as a guest: the Trip is at /trip/<id> and the guest can log in to save", async () => {
    renderApp(<App />, fake);
    await userEvent.click(await screen.findByRole("button", { name: "Open a sample Trip" }));
    expect(await screen.findByText("Fushimi Inari")).toBeTruthy();
    expect(openSampleTrip).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe(`/trip/${kyoto.id}`);
    expect(await screen.findByRole("button", { name: "Log in to save your progress" })).toBeTruthy();
  });

  it("says so when the sample Trip could not be opened, and can try again", async () => {
    vi.mocked(openSampleTrip).mockRejectedValueOnce(new Error("down"));
    renderApp(<App />, fake);
    await userEvent.click(await screen.findByRole("button", { name: "Open a sample Trip" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The sample Trip could not be opened. Try again.");
    expect(window.location.pathname).toBe("/");

    await userEvent.click(screen.getByRole("button", { name: "Open a sample Trip" }));
    expect(await screen.findByText("Fushimi Inari")).toBeTruthy();
  });

  it("Log in goes to the login page and comes back to the root", async () => {
    const login = vi.spyOn(fake, "loginRedirect");
    renderApp(<App />, fake);
    await userEvent.click(await screen.findByRole("button", { name: "Log in" }));
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ returnTo: "/", language: "en" }));
  });

  it("shows a neutral placeholder, not Log in or an action, until the session is known", async () => {
    let answer!: () => void;
    const slow: AuthClient = { ...fake, start: () => new Promise((resolve) => (answer = () => resolve({ returned: false, error: false }))) };
    renderApp(<App />, slow);
    expect(screen.getByRole("status", { name: "Loading your account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open a sample Trip" })).toBeNull();
    await act(async () => answer());
    expect(await screen.findByRole("button", { name: "Open a sample Trip" })).toBeTruthy();
  });
});

describe("an ended session", () => {
  it("asks to log in again instead of calling the server when the sample Trip is opened", async () => {
    const user = await fake.loginPopup({ language: "en" });
    const login = vi.spyOn(fake, "loginRedirect");
    // The login is still on the page, but the refresh token ran out.
    fake.expire();
    renderApp(<App />, { ...fake, start: async () => ({ user, returned: false, error: false }) });
    await screen.findByRole("button", { name: "Continue" });
    // The page finds out the way it does in real use: a request is refused.
    await act(async () => void (await authHooks()!.headers().catch(() => undefined)));
    await userEvent.click(await screen.findByRole("button", { name: "Open a sample Trip" }));
    expect(openSampleTrip).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ returnTo: "/" }));
  });
});

describe("after Log out", () => {
  it("shows the Landing page with the toast", async () => {
    window.history.replaceState(null, "", "/?loggedout=1");
    renderApp(<App />, fake);
    expect(await screen.findByText("You're logged out")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Open a sample Trip" })).toBeTruthy();
  });
});

describe("a guest with Trips", () => {
  beforeEach(() => void guestId());

  it("continues with the Trip opened last, and keeps the sample as a link", async () => {
    vi.mocked(listTrips).mockResolvedValue([kyoto, taipei]);
    localStorage.setItem("travel-planner.current-trip", taipei.id);
    renderApp(<App />, fake);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Din Tai Fung")).toBeTruthy();
    expect(window.location.pathname).toBe(`/trip/${taipei.id}`);
    expect(openSampleTrip).not.toHaveBeenCalled();
  });

  it("shows Welcome back, the note that Trips are only saved in this browser, and Log in", async () => {
    renderApp(<App />, fake);
    expect(await screen.findByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByText("Welcome back")).toBeTruthy();
    expect(screen.getByText("Your Trips are only saved in this browser.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("continues with the first Trip when the remembered one is gone", async () => {
    localStorage.setItem("travel-planner.current-trip", "deleted");
    renderApp(<App />, fake);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(window.location.pathname).toBe(`/trip/${kyoto.id}`);
  });

  it("opens the sample Trip from the link", async () => {
    renderApp(<App />, fake);
    await userEvent.click(await screen.findByRole("button", { name: "Open a sample Trip" }));
    expect(openSampleTrip).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Fushimi Inari")).toBeTruthy();
  });

  it("offers the sample Trip alone when the Trips cannot be loaded", async () => {
    vi.mocked(listTrips).mockRejectedValue(new Error("down"));
    renderApp(<App />, fake);
    expect(await screen.findByRole("button", { name: "Open a sample Trip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });
});

describe("a logged-in user", () => {
  it("with Trips continues, sees the avatar instead of Log in and no note about this browser", async () => {
    renderApp(<App />, await loggedIn());
    expect(await screen.findByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByText("Welcome back")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open a sample Trip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
    expect(screen.queryByText("Your Trips are only saved in this browser.")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("lena@example.com")).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "My Trips" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Log out" })).toBeTruthy();
  });

  it("without Trips is offered the sample Trip only", async () => {
    vi.mocked(listTrips).mockResolvedValue([]);
    renderApp(<App />, await loggedIn());
    expect(await screen.findByRole("button", { name: "Open a sample Trip" })).toBeTruthy();
    expect(screen.getByText("Start with a sample")).toBeTruthy();
    expect(screen.getByText("You get an editable copy in your Trips.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
  });
});
