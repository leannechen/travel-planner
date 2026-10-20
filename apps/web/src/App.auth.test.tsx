// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Event } from "@travel-planner/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { listTrips, updateEvent } from "./api";
import { authHooks, mergeGuest } from "./apiAuth";
import type { AuthClient, StartResult } from "./authClient";
import { createFakeAuth, type FakeAuth } from "./fakeAuth";
import { forgetGuestId } from "./guest";
import { takePendingEdits } from "./pendingEdits";
import { makeDay, makeEvent, makeTrip, memoryStore, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listTrips: vi.fn(),
  getMe: vi.fn(async () => ({ id: "me", guest: false })),
  listLegs: vi.fn(async () => []),
  getOpeningHours: vi.fn(async () => ({})),
  getPlaces: vi.fn(async () => []),
  updateEvent: vi.fn(),
}));
vi.mock("./apiAuth", async (importOriginal) => ({ ...(await importOriginal<typeof import("./apiAuth")>()), mergeGuest: vi.fn() }));
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ label }: { label: string }) => <textarea aria-label={label} />,
}));

const day = makeDay(1, [makeEvent({ title: "Fushimi Inari" })]);
const kyoto = makeTrip({ title: "Kyoto", days: [day], todos: [{ id: "t1", eventId: null, text: "Buy ICOCA card", done: false, createdBy: "me" }] });

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
  vi.mocked(listTrips).mockResolvedValue([kyoto]);
  window.history.replaceState(null, "", "/");
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

// A client whose start() the test answers.
function pendingClient(): { client: AuthClient; answer: (r: Partial<StartResult>) => void } {
  let answer!: (r: StartResult) => void;
  const client: AuthClient = { ...fake, start: () => new Promise<StartResult>((resolve) => (answer = resolve)) };
  return { client, answer: (r) => answer({ returned: false, error: false, ...r }) };
}

async function loggedInClient(start: Partial<StartResult> = {}): Promise<AuthClient> {
  const user = await fake.loginPopup({ language: "en" });
  return { ...fake, start: async () => ({ user, returned: false, error: false, ...start }) };
}

describe("account spot", () => {
  it("is a neutral placeholder while the session loads, never Log in first", async () => {
    const { client, answer } = pendingClient();
    renderApp(<App />, client);
    expect(screen.getByRole("status", { name: "Loading your account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Log in/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();

    await act(async () => answer({}));
    expect(await screen.findByRole("button", { name: "Log in to save your progress" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading your account" })).toBeNull();
  });

  it("shows a guest the Log in button, which goes to the login page in the interface language", async () => {
    const login = vi.spyOn(fake, "loginRedirect");
    renderApp(<App />, fake);
    await userEvent.click(await screen.findByRole("button", { name: "Log in to save your progress" }));
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ language: "en" }));
  });

  it("shows a user their email, My Trips and Log out", async () => {
    const logout = vi.spyOn(fake, "logout");
    renderApp(<App />, await loggedInClient());
    await userEvent.click(await screen.findByRole("button", { name: "Account" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("lena@example.com")).toBeTruthy();

    await userEvent.click(within(menu).getByRole("menuitem", { name: "My Trips" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(logout).toHaveBeenCalledWith(expect.stringContaining("loggedout=1"));
  });

  it("on a phone opens a sheet with the email, Language, Theme and Log out, and no My Trips", async () => {
    setPhone(true);
    renderApp(<App />, await loggedInClient());
    await userEvent.click(await screen.findByRole("button", { name: "Account" }));
    const sheet = screen.getByRole("dialog", { name: "Account" });
    expect(within(sheet).getByText("lena@example.com")).toBeTruthy();
    expect(within(sheet).getByText("Language")).toBeTruthy();
    expect(within(sheet).getByText("Theme")).toBeTruthy();
    expect(within(sheet).queryByText("My Trips")).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Log out" })).toBeTruthy();
  });

  it("on a phone leads a guest's sheet with Log in to save your progress", async () => {
    setPhone(true);
    renderApp(<App />, fake);
    await userEvent.click(await screen.findByRole("button", { name: "Account" }));
    const sheet = screen.getByRole("dialog", { name: "Account" });
    expect(within(sheet).getByRole("button", { name: "Log in to save your progress" })).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Log out" })).toBeNull();
  });
});

describe("after login", () => {
  it("shows the login error strip only when Auth0 returned an error, and it can be dismissed", async () => {
    renderApp(<App />, { ...fake, start: async () => ({ returned: true, error: true }) });
    expect((await screen.findByRole("alert")).textContent).toContain("Login didn't complete. Try again.");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Login didn't complete. Try again.")).toBeNull();
  });

  it("shows nothing when the user just went back from the login page", async () => {
    renderApp(<App />, fake);
    await screen.findByText("Fushimi Inari");
    expect(screen.queryByText("Login didn't complete. Try again.")).toBeNull();
  });

  it("says the guest's Trips were added, and stays in the Trip (37 A)", async () => {
    vi.mocked(mergeGuest).mockResolvedValue(1);
    localStorage.setItem("travel-planner.guest-id", crypto.randomUUID());
    renderApp(<App />, await loggedInClient({ returned: true }));
    expect(await screen.findByText("Your Trip was added to your account")).toBeTruthy();
    expect(await screen.findByText("Fushimi Inari")).toBeTruthy();
    expect(screen.queryByText("Choose a Trip")).toBeNull();
  });

  it("lands on the Trip list when there was nothing to add (37 B)", async () => {
    renderApp(<App />, await loggedInClient({ returned: true }));
    expect(await screen.findByText("Choose a Trip")).toBeTruthy();
    expect(screen.queryByText("Fushimi Inari")).toBeNull();
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});

describe("session expired", () => {
  // The API refuses the token: the way the page finds out in real use.
  async function expire() {
    fake.expire();
    await act(async () => void (await authHooks()!.headers().catch(() => undefined)));
  }

  it("keeps the Trip on screen, read-only, under a banner that cannot be dismissed", async () => {
    renderApp(<App />, await loggedInClient());
    await screen.findByText("Fushimi Inari");
    await expire();

    expect(screen.getByText("Your session expired.")).toBeTruthy();
    expect(screen.getByText("Read only")).toBeTruthy();
    expect(screen.getByText("Fushimi Inari")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Notes/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Buy ICOCA card/ }) as HTMLInputElement).disabled).toBe(true);
    // The account spot is back to Log in.
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "Log in" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Fushimi Inari/ }));
    expect(screen.queryByRole("complementary", { name: "Event" })).toBeNull();
  });

  async function typeInPanel(typed: string) {
    await userEvent.click(await screen.findByRole("button", { name: /Fushimi Inari/ }));
    const title = await screen.findByRole("textbox", { name: "Title" });
    await userEvent.type(title, typed);
    return title as HTMLInputElement;
  }

  it("keeps an open Event panel's edits, and Log in to save logs in by popup and then saves them", async () => {
    vi.mocked(updateEvent).mockImplementation(async (_t, id, input) => ({ ...kyoto.days[0]!.events[0]!, id, ...input }) as Event);
    const popup = vi.spyOn(fake, "loginPopup");
    renderApp(<App />, await loggedInClient());
    const title = await typeInPanel(" upper trail");
    await expire();

    // Still open, still typed, and Save now says what it will do.
    expect(title.value).toBe("Fushimi Inari upper trail");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(updateEvent).not.toHaveBeenCalled();

    popup.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Log in to save" }));
    expect(popup).toHaveBeenCalledOnce();
    await waitFor(() => expect(updateEvent).toHaveBeenCalledWith(kyoto.id, kyoto.days[0]!.events[0]!.id, expect.objectContaining({ title: "Fushimi Inari upper trail" })));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull());
    expect(screen.queryByText("Your session expired.")).toBeNull();
  });

  it("when the popup is blocked keeps the edits in sessionStorage, goes to the login page, and restores them", async () => {
    const redirect = vi.spyOn(fake, "loginRedirect");
    const client = await loggedInClient();
    fake.blockPopups = true;
    renderApp(<App />, client);
    await typeInPanel(" upper trail");
    await expire();
    await userEvent.click(screen.getByRole("button", { name: "Log in to save" }));

    expect(redirect).toHaveBeenCalledOnce();
    const kept = JSON.parse(sessionStorage.getItem("travel-planner.pending-edits")!);
    expect(kept).toMatchObject({ tripId: kyoto.id, eventId: kyoto.days[0]!.events[0]!.id, fields: { title: "Fushimi Inari upper trail" } });

    // The page comes back from the login page: the panel is open again with what was typed.
    cleanup();
    fake.blockPopups = false;
    renderApp(<App />, await loggedInClient({ returned: true }));
    const title = await screen.findByRole("textbox", { name: "Title" });
    expect((title as HTMLInputElement).value).toBe("Fushimi Inari upper trail");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    // Restored once.
    expect(takePendingEdits()).toBeUndefined();
  });

  it("the banner's Log in also tries the popup first, and keeps the edits if it has to redirect", async () => {
    const client = await loggedInClient();
    fake.blockPopups = true;
    vi.spyOn(fake, "loginRedirect");
    renderApp(<App />, client);
    await typeInPanel("!");
    await expire();
    await userEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Log in" }));
    expect(JSON.parse(sessionStorage.getItem("travel-planner.pending-edits")!).fields.title).toBe("Fushimi Inari!");
  });
});
