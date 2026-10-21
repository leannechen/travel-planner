// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { acceptInvitation, getInvitationPreview, listTrips, resendVerification } from "./api";
import { createFakeAuth, type FakeAuth } from "./fakeAuth";
import { forgetGuestId } from "./guest";
import { makeTrip, memoryStore, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listTrips: vi.fn(),
  getMe: vi.fn(async () => ({ id: "me", guest: false })),
  listLegs: vi.fn(async () => []),
  getOpeningHours: vi.fn(async () => ({})),
  getPlaces: vi.fn(async () => []),
  getInvitationPreview: vi.fn(),
  acceptInvitation: vi.fn(),
  resendVerification: vi.fn(),
}));

const preview = { tripTitle: "Kyoto & Osaka", invitedEmail: "m*i@example.com", inviterEmail: "lena@example.com" };
const joinedTrip = makeTrip({ title: "Kyoto & Osaka", role: "editor" });

let fake: FakeAuth;

beforeEach(() => {
  setPhone(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(listTrips).mockResolvedValue([joinedTrip]);
  vi.mocked(getInvitationPreview).mockResolvedValue(preview);
  vi.mocked(acceptInvitation).mockResolvedValue({ ok: true, trip: { tripId: joinedTrip.id, tripTitle: "Kyoto & Osaka" } });
  window.history.replaceState(null, "", "/?invite=secret-token");
  localStorage.clear();
  sessionStorage.clear();
  forgetGuestId();
  fake = createFakeAuth({ store: memoryStore(), navigate: () => undefined });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function loginAs(email: string) {
  fake = createFakeAuth({ store: memoryStore(), navigate: () => undefined, email });
  await fake.loginRedirect({ language: "en" });
}

describe("an invitation link, logged out", () => {
  it("names who invited whom to what, and the invited address", async () => {
    renderApp(<App />, fake);

    expect(await screen.findByRole("heading", { name: /lena@example.com invited you to edit\s*Kyoto & Osaka/ })).toBeTruthy();
    expect(screen.getByText("m*i@example.com")).toBeTruthy();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("Log in and Sign up go to the login page with the invited address, and come back to the invitation", async () => {
    const login = vi.spyOn(fake, "loginRedirect");
    renderApp(<App />, fake);

    await userEvent.click(await screen.findByRole("button", { name: "Log in" }));
    expect(login).toHaveBeenLastCalledWith(expect.objectContaining({ returnTo: "/?invite=secret-token" }));
    expect(login.mock.lastCall![0]).not.toHaveProperty("screenHint");
    await userEvent.click(screen.getByRole("button", { name: "Sign up" }));
    expect(login).toHaveBeenLastCalledWith(expect.objectContaining({ returnTo: "/?invite=secret-token", screenHint: "signup" }));
  });

  it("shows Auth0's error when the login did not complete", async () => {
    const store = memoryStore();
    const before = createFakeAuth({ store, navigate: () => undefined });
    before.failNextLogin();
    renderApp(<App />, before);
    await userEvent.click(await screen.findByRole("button", { name: "Log in" }));
    // The page loads again after the redirect, with a new client over the same storage.
    cleanup();
    renderApp(<App />, createFakeAuth({ store, navigate: () => undefined }));
    expect(await screen.findByText("Login didn't complete. Try again.")).toBeTruthy();
  });

  it("says so when the link is not valid", async () => {
    vi.mocked(getInvitationPreview).mockResolvedValue(undefined);
    renderApp(<App />, fake);
    expect(await screen.findByRole("heading", { name: "This invitation is not valid any more" })).toBeTruthy();
  });
});

describe("an invitation link, logged in", () => {
  it("joins with the matching account: the Trip opens with a message and the link is gone from the address", async () => {
    await loginAs("mei@example.com");
    renderApp(<App />, fake);

    expect(await screen.findByText("You joined Kyoto & Osaka as an Editor")).toBeTruthy();
    expect(acceptInvitation).toHaveBeenCalledWith("secret-token");
    expect(window.location.search).toBe(`?trip=${joinedTrip.id}`);
  });

  it("offers to log in as the invited address when the account is another one", async () => {
    vi.mocked(acceptInvitation).mockResolvedValue({ ok: false, reason: "wrong_account" });
    await loginAs("mei@work.example");
    const login = vi.spyOn(fake, "loginRedirect");
    renderApp(<App />, fake);

    expect(await screen.findByRole("heading", { name: "This invitation is for another account" })).toBeTruthy();
    expect(screen.getByText("mei@work.example")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Log in as m*i@example.com" }));
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ returnTo: "/?invite=secret-token", prompt: "login" }));
  });

  it("Go to my Trips leaves the invitation open for later", async () => {
    vi.mocked(acceptInvitation).mockResolvedValue({ ok: false, reason: "wrong_account" });
    await loginAs("mei@work.example");
    renderApp(<App />, fake);

    await userEvent.click(await screen.findByRole("button", { name: "Go to my Trips" }));

    await waitFor(() => expect(listTrips).toHaveBeenCalled());
    expect(window.location.search).not.toContain("invite");
    expect(screen.queryByText(/You joined/)).toBeNull();
  });

  it("asks for the email to be verified, checks again with a fresh token, and can send the link again", async () => {
    vi.mocked(acceptInvitation).mockResolvedValue({ ok: false, reason: "email_not_verified" });
    await loginAs("mei@example.com");
    const token = vi.spyOn(fake, "getToken");
    renderApp(<App />, fake);

    expect(await screen.findByRole("heading", { name: "Verify your email to join" })).toBeTruthy();
    expect(screen.queryByText("Not verified yet. Check your inbox and spam folder.")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Send the link again" }));
    expect(resendVerification).toHaveBeenCalled();
    expect(await screen.findByText("Link sent again to m*i@example.com")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "I've verified, continue" }));
    expect(await screen.findByText("Not verified yet. Check your inbox and spam folder.")).toBeTruthy();
    expect(token).toHaveBeenCalledWith(true);
    expect(acceptInvitation).toHaveBeenCalledTimes(2);

    vi.mocked(acceptInvitation).mockResolvedValue({ ok: true, trip: { tripId: joinedTrip.id, tripTitle: "Kyoto & Osaka" } });
    await userEvent.click(screen.getByRole("button", { name: "I've verified, continue" }));
    expect(await screen.findByText("You joined Kyoto & Osaka as an Editor")).toBeTruthy();
  });
});
