// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createTrip, listTrips } from "./api";
import { makeDay, makeEvent, makeTrip, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listTrips: vi.fn(),
  createTrip: vi.fn(),
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
  window.history.replaceState(null, "", "/");
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
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
}

describe("one Trip at a time", () => {
  it("keeps the Map View when switching Trips", async () => {
    renderApp(<App />);
    await screen.findByText("Fushimi Inari");
    await userEvent.click(screen.getByRole("button", { name: /Map/ }));
    expect(window.location.search).toContain("view=map");

    await switchTo("Taipei");
    await waitFor(() => expect(screen.getByRole("button", { name: /Map/ }).getAttribute("aria-pressed")).toBe("true"));
    expect(window.location.search).toContain(`trip=${taipei.id}`);
    expect(window.location.search).toContain("view=map");
  });

  it("shows only the first Trip, and the other after switching", async () => {
    renderApp(<App />);
    expect(await screen.findByText("Fushimi Inari")).toBeTruthy();
    expect(screen.queryByText("Din Tai Fung")).toBeNull();

    await switchTo("Taipei");
    expect(await screen.findByText("Din Tai Fung")).toBeTruthy();
    expect(screen.queryByText("Fushimi Inari")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("trip")).toBe(taipei.id);
  });

  it("shows the Trip named in the URL", async () => {
    window.history.replaceState(null, "", `/?trip=${taipei.id}`);
    renderApp(<App />);
    expect(await screen.findByText("Din Tai Fung")).toBeTruthy();
  });

  it("shows a Trip created from the list", async () => {
    const seoul = makeTrip({ title: "Seoul", days: [makeDay(1, [makeEvent({ title: "Gyeongbokgung" })])] });
    vi.mocked(createTrip).mockResolvedValue(seoul);
    renderApp(<App />);
    await screen.findByText("Fushimi Inari");
    await openList();
    await userEvent.type(await screen.findByLabelText("Trip title"), "Seoul");
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
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
