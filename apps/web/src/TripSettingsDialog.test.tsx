// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "./test-helpers";
import { TripSettingsDialog } from "./TripSettingsDialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(cleanup);

function setup(startDate?: string, onSave = vi.fn(async () => undefined), owner = true) {
  const onClose = vi.fn();
  const onDelete = vi.fn();
  renderApp(<TripSettingsDialog tripTitle="Kyoto" owner={owner} startDate={startDate} travelMode="transit" onSave={onSave} onDelete={onDelete} onClose={onClose} />);
  return { onSave, onClose, onDelete, field: () => screen.getByLabelText(/Start date/) as HTMLInputElement };
}

describe("Trip settings", () => {
  it("renames the Trip with Save, together with the other settings", async () => {
    const { onSave } = setup();
    const title = screen.getByLabelText("Trip title") as HTMLInputElement;
    expect(title.value).toBe("Kyoto");
    await userEvent.clear(title);
    await userEvent.type(title, "  Kyoto & Osaka ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ title: "Kyoto & Osaka" });
  });

  it("does not save an empty title", async () => {
    setup();
    await userEvent.clear(screen.getByLabelText("Trip title"));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks to delete the Trip with Delete Trip…, for the Owner only", async () => {
    const { onDelete } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete Trip…" }));
    expect(onDelete).toHaveBeenCalled();
    cleanup();
    setup(undefined, undefined, false);
    expect(screen.queryByRole("button", { name: "Delete Trip…" })).toBeNull();
    expect(screen.queryByLabelText("Trip title")).toBeNull();
  });

  it("shows the saved date, with Clear enabled", () => {
    const { field } = setup("2026-11-03");
    expect(field().value).toBe("2026-11-03");
    expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("has an empty field and a disabled Clear without a date", () => {
    const { field } = setup();
    expect(field().value).toBe("");
    expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves nothing until Save, then saves and closes", async () => {
    const { field, onSave, onClose } = setup();
    const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(save());
    expect(onSave).toHaveBeenCalledWith({ startDate: "2026-12-01" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("does not save an out-of-range year", () => {
    const { field } = setup();
    fireEvent.change(field(), { target: { value: "110320-02-06" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not save a half-typed date", () => {
    const { field } = setup("2026-11-03");
    // jsdom never reports a half-typed date, so the field says so by hand.
    Object.defineProperty(field(), "validity", { value: { badInput: true }, configurable: true });
    fireEvent.change(field(), { target: { value: "" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Cancel and the close button leave without saving", async () => {
    const { field, onSave, onClose } = setup();
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Esc leaves without saving", () => {
    const { field, onSave, onClose } = setup();
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    fireEvent(screen.getByRole("dialog", { hidden: true }), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("cannot be cancelled or closed while the save is in flight", async () => {
    const { field, onClose } = setup(undefined, vi.fn(() => new Promise<undefined>(() => undefined)));
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent(screen.getByRole("dialog", { hidden: true }), new Event("cancel", { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Clear empties the field, and Save then removes the date", async () => {
    const { field, onSave, onClose } = setup("2026-11-03");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(field().value).toBe("");
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ startDate: null });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("stays open with an error when the save fails, and can be saved again", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    const { field, onClose } = setup(undefined, onSave);
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The settings could not be saved");
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows the Trip's default travel mode, and saves a changed one alone", async () => {
    const { onSave, onClose } = setup("2026-11-03");
    expect((screen.getByRole("radio", { name: "Transit" }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole("radio", { name: "Drive" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ travelMode: "drive" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("saves the date and the mode together", async () => {
    const { field, onSave } = setup();
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByRole("radio", { name: "Walk" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ startDate: "2026-12-01", travelMode: "walk" });
  });
});
