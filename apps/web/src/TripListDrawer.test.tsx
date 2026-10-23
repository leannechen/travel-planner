// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { makeTrip, renderApp, setPhone } from "./test-helpers";
import { TripListDrawer } from "./TripListDrawer";

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

function setup(trips = [kyoto, taipei], extra: { readOnly?: boolean } = {}) {
  const handlers = {
    onSwitch: vi.fn(),
    onCreate: vi.fn(async () => undefined),
    onClose: vi.fn(),
    onRename: vi.fn(async () => undefined),
    onDelete: vi.fn(async () => undefined),
    onExport: vi.fn(async () => undefined),
    onImport: vi.fn(async () => undefined),
    onOpenSettings: vi.fn(),
    onShare: vi.fn(),
  };
  renderApp(<TripListDrawer trips={trips} currentId={kyoto.id} {...handlers} {...extra} />);
  return handlers;
}

const openMenu = (title: string) => userEvent.click(screen.getByRole("button", { name: `Actions for ${title}` }));

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
    await userEvent.type(screen.getByLabelText("Trip title"), "Seoul");
    await userEvent.click(screen.getByRole("button", { name: "Create Trip" }));
    expect(onCreate).toHaveBeenCalledWith({ title: "Seoul", travelMode: "transit", startDate: null });
  });

  it("closes with the Close button", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("gives the Owner Rename, Trip settings, Share and Delete in the menu", async () => {
    const { onOpenSettings, onShare } = setup();
    await openMenu("Taipei weekend");
    expect(screen.getAllByRole("button", { name: /^(Rename|Trip settings|Share…|Delete Trip…)$/ }).map((item) => item.textContent)).toEqual(["Rename", "Trip settings", "Share…", "Delete Trip…"]);
    await userEvent.click(screen.getByRole("button", { name: "Trip settings" }));
    expect(onOpenSettings).toHaveBeenCalledWith(taipei.id);
    await openMenu("Taipei weekend");
    await userEvent.click(screen.getByRole("button", { name: "Share…" }));
    expect(onShare).toHaveBeenCalledWith(taipei.id);
  });

  it("gives an Editor only Trip settings for a shared Trip", async () => {
    setup([kyoto, seoul]);
    await openMenu("Seoul with Mei");
    expect(screen.getAllByRole("button", { name: /^(Rename|Trip settings|Share…|Delete Trip…)$/ }).map((item) => item.textContent)).toEqual(["Trip settings"]);
  });

  it("renames a Trip from its menu", async () => {
    const { onRename } = setup();
    await openMenu("Taipei weekend");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("heading", { name: "Rename" })).toBeTruthy();
    const field = screen.getByLabelText("New title");
    expect((field as HTMLInputElement).value).toBe("Taipei weekend");
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    await userEvent.clear(field);
    await userEvent.type(field, "Taipei food");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onRename).toHaveBeenCalledWith(taipei.id, "Taipei food");
  });

  it("deletes a Trip only after its title is typed", async () => {
    const { onDelete } = setup();
    await openMenu("Taipei weekend");
    await userEvent.click(screen.getByRole("button", { name: "Delete Trip…" }));
    const confirm = screen.getByRole("button", { name: "Delete Trip" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await userEvent.type(screen.getByLabelText("Type the Trip title to confirm"), "Taipei");
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await userEvent.type(screen.getByLabelText("Type the Trip title to confirm"), " weekend");
    await userEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledWith(taipei.id);
  });

  it("keeps the delete question open and says so when the Trip could not be deleted", async () => {
    const { onDelete } = setup();
    onDelete.mockRejectedValueOnce(new Error("no"));
    await openMenu("Taipei weekend");
    await userEvent.click(screen.getByRole("button", { name: "Delete Trip…" }));
    await userEvent.type(screen.getByLabelText("Type the Trip title to confirm"), "Taipei weekend");
    await userEvent.click(screen.getByRole("button", { name: "Delete Trip" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The Trip could not be deleted. Try again.");
    expect(screen.getByLabelText("Type the Trip title to confirm")).toBeTruthy();
  });

  it("keeps the rename dialog open with an error when the rename fails, and Cancel leaves it", async () => {
    const { onRename } = setup();
    onRename.mockRejectedValueOnce(new Error("Nope"));
    await openMenu("Taipei weekend");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.type(screen.getByLabelText("New title"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The Trip could not be renamed. Try again.");
    expect(screen.getByLabelText("New title")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("New title")).toBeNull();
  });

  it("keeps the New Trip dialog open with its fields when the Trip could not be created", async () => {
    const { onCreate } = setup();
    onCreate.mockRejectedValueOnce(new Error("no"));
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    await userEvent.type(screen.getByLabelText("Trip title"), "Seoul");
    await userEvent.click(screen.getByRole("button", { name: "Create Trip" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The Trip could not be created. Try again.");
    expect((screen.getByLabelText("Trip title") as HTMLInputElement).value).toBe("Seoul");
  });

  it("passes the start date to the new Trip", async () => {
    const { onCreate } = setup();
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    await userEvent.type(screen.getByLabelText("Trip title"), "Seoul");
    fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: "2026-11-03" } });
    await userEvent.click(screen.getByRole("button", { name: "Create Trip" }));
    expect(onCreate).toHaveBeenCalledWith({ title: "Seoul", travelMode: "transit", startDate: "2026-11-03" });
  });

  it("offers no New Trip, Rename, Share or Delete when the session has ended", async () => {
    setup([kyoto, taipei], { readOnly: true });
    expect(screen.queryByRole("button", { name: "New Trip" })).toBeNull();
    await openMenu("Taipei weekend");
    expect(screen.getByRole("button", { name: "Trip settings" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Trip…" })).toBeNull();
  });

  it("closes the menu on Escape without closing the drawer", async () => {
    const { onClose } = setup();
    await openMenu("Taipei weekend");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes with a click on the dimmed page behind the sheet on a phone", async () => {
    setPhone(true);
    const { onClose } = setup();
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
    // The sheet fills the dialog element; a click on the element itself is a click on the backdrop.
    await userEvent.click(document.querySelector("dialog.trip-list-drawer")!);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when the click is inside the sheet", async () => {
    setPhone(true);
    const { onClose } = setup();
    await userEvent.click(screen.getByText("My Trips · 2"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Backup", () => {
  it("exports the Trip from its menu, for an Editor too", async () => {
    const { onExport } = setup([kyoto, seoul]);
    await openMenu("Seoul with Mei");
    await userEvent.click(screen.getByRole("button", { name: "Export backup" }));
    expect(onExport).toHaveBeenCalledWith(seoul.id);
  });

  it("says when the backup could not be saved", async () => {
    const { onExport } = setup();
    onExport.mockRejectedValueOnce(new Error("offline"));
    await openMenu("Kyoto & Osaka");
    await userEvent.click(screen.getByRole("button", { name: "Export backup" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The backup could not be saved. Try again.");
  });

  it("imports the file that is chosen", async () => {
    const { onImport } = setup();
    const file = new File(["{}"], "kyoto-backup.json", { type: "application/json" });
    await userEvent.upload(screen.getByTestId("backup-file"), file);
    expect(onImport).toHaveBeenCalledWith(file);
  });

  it("says when the file is not a backup, and lets the user choose another", async () => {
    const { onImport } = setup();
    onImport.mockRejectedValueOnce(new ApiError("This is not a valid backup file", "invalid_backup"));
    await userEvent.upload(screen.getByTestId("backup-file"), new File(["x"], "notes.json", { type: "application/json" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This file is not a backup this app can read.");
    expect(screen.getByRole("button", { name: "Import backup…" }).hasAttribute("disabled")).toBe(false);
  });

  it("offers no import or export when the session has ended", async () => {
    setup([kyoto], { readOnly: true });
    expect(screen.queryByRole("button", { name: "Import backup…" })).toBeNull();
    await openMenu("Kyoto & Osaka");
    expect(screen.queryByRole("button", { name: "Export backup" })).toBeNull();
  });

  it("reminds about a backup when deleting", async () => {
    setup();
    await openMenu("Kyoto & Osaka");
    await userEvent.click(screen.getByRole("button", { name: "Delete Trip…" }));
    expect(screen.getByText("Tip: export a full backup first.")).toBeTruthy();
  });
});
