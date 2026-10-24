// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createTrip, deleteTrip, listTrips } from "./api";
import { makeDay, makeEvent, makeTrip, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listTrips: vi.fn(),
  createTrip: vi.fn(),
  deleteTrip: vi.fn(async () => undefined),
  getMe: vi.fn(async () => ({ id: "me" })),
  listLegs: vi.fn(async () => []),
  getOpeningHours: vi.fn(async () => ({})),
  getPlaces: vi.fn(async () => []),
}));

const kyoto = makeTrip({ title: "Kyoto", days: [makeDay(1, [makeEvent({ title: "Fushimi Inari" })])] });
const taipei = makeTrip({ title: "Taipei", days: [makeDay(1, [makeEvent({ title: "Din Tai Fung" })])] });

beforeEach(() => {
  setPhone(false);
  // jsdom has no ResizeObserver, which the Notes panel uses to stay in view.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(listTrips).mockResolvedValue([kyoto, taipei]);
  window.history.replaceState(null, "", "/trip/current");
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The Trip title, with its arrow, opens the list.
const openList = () => userEvent.click(screen.getByRole("button", { name: "Kyoto" }));

async function switchTo(name: string) {
  await openList();
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(`^${name}`) }));
}

describe("one Trip at a time", () => {
  it("shows the next Trip after the one shown is deleted", async () => {
    renderApp(<App />);
    await screen.findByText("Fushimi Inari");
    await openList();
    await userEvent.click(screen.getByRole("button", { name: "Actions for Kyoto" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Trip…" }));
    await userEvent.type(screen.getByLabelText("Type the Trip title to confirm"), "Kyoto");
    await userEvent.click(screen.getByRole("button", { name: "Delete Trip" }));

    expect(deleteTrip).toHaveBeenCalledWith(kyoto.id);
    expect(await screen.findByText("Din Tai Fung")).toBeTruthy();
    expect(screen.queryByText("Fushimi Inari")).toBeNull();
    await waitFor(() => expect(window.location.pathname).toBe(`/trip/${taipei.id}`));
  });

  it("keeps the Map View when switching Trips", async () => {
    renderApp(<App />);
    await screen.findByText("Fushimi Inari");
    await userEvent.click(screen.getByRole("button", { name: /Map/ }));
    expect(window.location.search).toContain("view=map");

    await switchTo("Taipei");
    await waitFor(() => expect(screen.getByRole("button", { name: /Map/ }).getAttribute("aria-pressed")).toBe("true"));
    expect(window.location.pathname).toBe(`/trip/${taipei.id}`);
    expect(window.location.search).toContain("view=map");
  });

  it("shows only the first Trip, and the other after switching", async () => {
    renderApp(<App />);
    expect(await screen.findByText("Fushimi Inari")).toBeTruthy();
    expect(screen.queryByText("Din Tai Fung")).toBeNull();

    await switchTo("Taipei");
    expect(await screen.findByText("Din Tai Fung")).toBeTruthy();
    expect(screen.queryByText("Fushimi Inari")).toBeNull();
    expect(window.location.pathname).toBe(`/trip/${taipei.id}`);
  });

  it("shows the Trip named in the address", async () => {
    window.history.replaceState(null, "", `/trip/${taipei.id}`);
    renderApp(<App />);
    expect(await screen.findByText("Din Tai Fung")).toBeTruthy();
  });

  it("still understands the older /?trip= address, and moves it to /trip/<id>", async () => {
    window.history.replaceState(null, "", `/?trip=${taipei.id}`);
    renderApp(<App />);
    expect(await screen.findByText("Din Tai Fung")).toBeTruthy();
    expect(window.location.pathname).toBe(`/trip/${taipei.id}`);
    expect(window.location.search).not.toContain("trip=");
  });

  it("shows a Trip created from the list", async () => {
    const seoul = makeTrip({ title: "Seoul", days: [makeDay(1, [makeEvent({ title: "Gyeongbokgung" })])] });
    vi.mocked(createTrip).mockResolvedValue(seoul);
    renderApp(<App />);
    await screen.findByText("Fushimi Inari");
    await openList();
    await userEvent.click(await screen.findByRole("button", { name: "New Trip" }));
    await userEvent.type(await screen.findByLabelText("Trip title"), "Seoul");
    await userEvent.click(screen.getByRole("button", { name: "Create Trip" }));
    expect(createTrip).toHaveBeenCalledWith({ title: "Seoul", travelMode: "transit", startDate: null });
    expect(await screen.findByText("Gyeongbokgung")).toBeTruthy();
  });

  it("closes the Notes panel of the Trip being left", async () => {
    renderApp(<App />);
    await screen.findByText("Fushimi Inari");
    await userEvent.click(screen.getByRole("button", { name: /^Notes/ }));
    expect(await screen.findByPlaceholderText(/Write a Note/)).toBeTruthy();
    await switchTo("Taipei");
    await screen.findByText("Din Tai Fung");
    await waitFor(() => expect(screen.queryByPlaceholderText(/Write a Note/)).toBeNull());
  });

  describe("the logo", () => {
    it("goes to the Landing page", async () => {
      renderApp(<App />);
      await screen.findByText("Fushimi Inari");
      await userEvent.click(screen.getByRole("link", { name: "Home" }));
      await waitFor(() => expect(window.location.pathname).toBe("/"));
      await waitFor(() => expect(screen.queryByText("Fushimi Inari")).toBeNull());
    });

    it("asks first when the Event panel has an unsaved change", async () => {
      renderApp(<App />);
      await userEvent.click(await screen.findByText("Fushimi Inari"));
      await userEvent.type(await screen.findByLabelText(/^Title/), " at dawn");
      await userEvent.click(screen.getByRole("link", { name: "Home" }));
      expect(await screen.findByText("Save your changes?")).toBeTruthy();
      expect(window.location.pathname).toMatch(/^\/trip\//);
    });
  });

  describe("with an unsaved change in the Event panel", () => {
    async function editTitle() {
      renderApp(<App />);
      await userEvent.click(await screen.findByText("Fushimi Inari"));
      const title = await screen.findByLabelText(/^Title/);
      await userEvent.type(title, " at dawn");
      await switchTo("Taipei");
      return screen.findByText("Save your changes?");
    }

    it("asks first, and Keep editing stays on the Trip", async () => {
      await editTitle();
      await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(screen.queryByText("Save your changes?")).toBeNull();
      expect(screen.queryByText("Din Tai Fung")).toBeNull();
      expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("Fushimi Inari at dawn");
    });

    it("Discard switches and closes the panel", async () => {
      await editTitle();
      await userEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(await screen.findByText("Din Tai Fung")).toBeTruthy();
      await waitFor(() => expect(screen.queryByLabelText(/^Title/)).toBeNull());
    });
  });
});

describe("pinned Trip list", () => {
  // A wide desktop window: the min-width query matches, the phone query does not.
  const wide = () =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));

  it("pins from the drawer into a column that stays open when a Trip is chosen, and unpins", async () => {
    wide();
    renderApp(<App />);
    await screen.findByRole("button", { name: "Kyoto" });
    await openList();
    await userEvent.click(await screen.findByRole("button", { name: "Keep the Trip list open" }));
    expect(localStorage.getItem("travel-planner.trip-list-pinned")).toBe("1");
    expect(document.querySelector("dialog.trip-list-drawer")).toBeNull();
    expect(document.querySelector(".trip-list-pinned")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^Taipei/ }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Taipei" })).toBeTruthy());
    expect(document.querySelector(".trip-list-pinned")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Unpin the Trip list" }));
    expect(localStorage.getItem("travel-planner.trip-list-pinned")).toBe("0");
    expect(document.querySelector(".trip-list-pinned")).toBeNull();
    // Unpinning turns the column back into the open drawer.
    expect(document.querySelector("dialog.trip-list-drawer")).not.toBeNull();
  });

  it("starts pinned when it was pinned before, and not in a narrow window", async () => {
    localStorage.setItem("travel-planner.trip-list-pinned", "1");
    wide();
    renderApp(<App />);
    await screen.findByRole("button", { name: /^Taipei/ });
    expect(document.querySelector(".trip-list-pinned")).not.toBeNull();
    cleanup();
    setPhone(false);
    renderApp(<App />);
    await screen.findByRole("button", { name: "Kyoto" });
    expect(document.querySelector(".trip-list-pinned")).toBeNull();
  });
});

describe("Trip list and its dialogs", () => {
  it("stays open under Trip settings after Cancel", async () => {
    renderApp(<App />);
    await screen.findByRole("button", { name: "Kyoto" });
    await openList();
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Kyoto" }));
    await userEvent.click(within(document.querySelector<HTMLElement>(".trip-menu")!).getByRole("button", { name: "Trip settings" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(document.querySelector("dialog.trip-list-drawer")).not.toBeNull();
  });
});
