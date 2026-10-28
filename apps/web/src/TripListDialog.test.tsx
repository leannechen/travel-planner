// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import type { TripGeneration } from "./tripGeneration";
import { makeTrip, renderApp, setPhone } from "./test-helpers";
import { TripListDialog } from "./TripListDialog";

beforeEach(() => {
  setPhone(false);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(cleanup);

const kyoto = makeTrip({ title: "Kyoto & Osaka" });
const taipei = makeTrip({ title: "Taipei weekend" });
const seoul = makeTrip({ title: "Seoul with Mei", role: "editor" });

function setup(trips = [kyoto, taipei], extra: { readOnly?: boolean; onImportLogin?: () => void; generation?: TripGeneration } = {}) {
  const handlers = {
    onSwitch: vi.fn(),
    onCreate: vi.fn(async () => undefined),
    onClose: vi.fn(),
    onImport: vi.fn(async () => undefined),
  };
  renderApp(<TripListDialog trips={trips} currentId={kyoto.id} {...handlers} {...extra} />);
  return handlers;
}

describe("Trip list", () => {
  it("lists my Trips and the Trips shared with me in sections with counts", () => {
    setup([kyoto, taipei, seoul]);
    expect(screen.getByText("My Trips · 2")).toBeTruthy();
    expect(screen.getByText("Shared with me · 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Kyoto & Osaka/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /^Taipei weekend/ }).getAttribute("aria-current")).toBeNull();
  });

  it("switches to the Trip that is clicked", async () => {
    const { onSwitch } = setup();
    await userEvent.click(screen.getByRole("button", { name: /^Taipei weekend/ }));
    expect(onSwitch).toHaveBeenCalledWith(taipei.id);
  });

  it("creates a blank Trip with a title, a start date and the default travel mode", async () => {
    const { onCreate } = setup();
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    await userEvent.click(screen.getByRole("button", { name: /^Blank Trip/ }));
    const create = screen.getByRole("button", { name: "Create Trip" });
    expect(create.hasAttribute("disabled")).toBe(true);
    await userEvent.type(screen.getByLabelText("Trip title"), "Seoul");
    await userEvent.click(screen.getByLabelText("Walk"));
    await userEvent.click(create);
    expect(onCreate).toHaveBeenCalledWith({ title: "Seoul", travelMode: "walk", startDate: null });
  });

  it("starts a new Trip on public transit by default", async () => {
    const { onCreate } = setup();
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    await userEvent.click(screen.getByRole("button", { name: /^Blank Trip/ }));
    await userEvent.type(screen.getByLabelText("Trip title"), "Seoul");
    await userEvent.click(screen.getByRole("button", { name: "Create Trip" }));
    expect(onCreate).toHaveBeenCalledWith({ title: "Seoul", travelMode: "transit", startDate: null });
  });

  it("closes with the Close button", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the New Trip dialog open with its fields when the Trip could not be created", async () => {
    const { onCreate } = setup();
    onCreate.mockRejectedValueOnce(new Error("no"));
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    await userEvent.click(screen.getByRole("button", { name: /^Blank Trip/ }));
    await userEvent.type(screen.getByLabelText("Trip title"), "Seoul");
    await userEvent.click(screen.getByRole("button", { name: "Create Trip" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The Trip could not be created. Try again.");
    expect((screen.getByLabelText("Trip title") as HTMLInputElement).value).toBe("Seoul");
  });

  it("passes the start date to the new Trip", async () => {
    const { onCreate } = setup();
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    await userEvent.click(screen.getByRole("button", { name: /^Blank Trip/ }));
    await userEvent.type(screen.getByLabelText("Trip title"), "Seoul");
    fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: "2026-11-03" } });
    await userEvent.click(screen.getByRole("button", { name: "Create Trip" }));
    expect(onCreate).toHaveBeenCalledWith({ title: "Seoul", travelMode: "transit", startDate: "2026-11-03" });
  });

  it("closes with a click on the dimmed page behind the sheet on a phone", async () => {
    setPhone(true);
    const { onClose } = setup();
    // The sheet fills the dialog element; a click on the element itself is a click on the backdrop.
    await userEvent.click(document.querySelector("dialog.trip-list-dialog")!);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when the click is inside the sheet", async () => {
    setPhone(true);
    const { onClose } = setup();
    await userEvent.click(screen.getByText("My Trips · 2"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Row", () => {
  it("has no menu button: opening the Trip is its one action", () => {
    setup([kyoto, taipei, seoul]);
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Rename|Share…|Trip settings|Delete Trip…|Export/ })).toBeNull();
  });

  it("marks the open Trip as Current", () => {
    setup();
    expect(screen.getAllByText("Current")).toHaveLength(1);
  });

  it("offers no New Trip when the session has ended", () => {
    setup([kyoto, taipei], { readOnly: true });
    expect(screen.queryByRole("button", { name: "New Trip" })).toBeNull();
  });

  it("is a centered modal with a New Trip button next to its title, not a drawer", () => {
    setup();
    expect(document.querySelector("dialog.trip-list-dialog")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep the Trip list open" })).toBeNull();
  });
});

describe("New Trip", () => {
  it("replaces My Trips while it is open, and My Trips comes back on Cancel", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    expect(screen.queryByText("My Trips · 2")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("My Trips · 2")).toBeTruthy();
    // Back as a modal, not just in the page.
    expect(document.querySelector("dialog.trip-list-dialog")!.hasAttribute("open")).toBe(true);
  });

  it("offers Blank Trip and Import backup…, and Generate with AI only with generation", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    expect(screen.getByRole("button", { name: /^Blank Trip/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Import backup…/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Generate with AI/ })).toBeNull();
  });

  it("imports the file that is chosen", async () => {
    const { onImport } = setup();
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    const file = new File(["{}"], "kyoto-backup.json", { type: "application/json" });
    await userEvent.upload(screen.getByTestId("backup-file"), file);
    expect(onImport).toHaveBeenCalledWith(file);
  });

  it("says when the file is not a backup, and lets the user choose another", async () => {
    const { onImport } = setup();
    onImport.mockRejectedValueOnce(new ApiError("This is not a valid backup file", "invalid_backup"));
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    await userEvent.upload(screen.getByTestId("backup-file"), new File(["x"], "notes.json", { type: "application/json" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This file is not a backup this app can read.");
    expect(screen.getByRole("button", { name: /^Import backup…/ }).hasAttribute("disabled")).toBe(false);
  });

  it("says how many lookups a backup needs when more are needed than are left today", async () => {
    const { onImport } = setup();
    onImport.mockRejectedValueOnce(new ApiError("Too many", "lookup_limit", { needed: 240, remaining: 75 }));
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    await userEvent.upload(screen.getByTestId("backup-file"), new File(["{}"], "kyoto-backup.json", { type: "application/json" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This backup needs 240 place and travel time lookups, and 75 are left today. Try again tomorrow.");
  });

  it("sends a guest to log in instead of asking for a file", async () => {
    const onImportLogin = vi.fn();
    const { onImport } = setup([kyoto], { onImportLogin });
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    const click = vi.spyOn(HTMLInputElement.prototype, "click");
    await userEvent.click(screen.getByRole("button", { name: /^Import backup…/ }));
    expect(onImportLogin).toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
