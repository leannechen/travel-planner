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

function setup(startDate?: string, onChangeStartDate = vi.fn(async () => undefined)) {
  const onClose = vi.fn();
  renderApp(<TripSettingsDialog tripTitle="Kyoto" startDate={startDate} onChangeStartDate={onChangeStartDate} onClose={onClose} />);
  return { onChangeStartDate, onClose, field: () => screen.getByLabelText(/Start date/) as HTMLInputElement };
}

describe("Trip settings", () => {
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
    const { field, onChangeStartDate, onClose } = setup();
    const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    expect(onChangeStartDate).not.toHaveBeenCalled();
    await userEvent.click(save());
    expect(onChangeStartDate).toHaveBeenCalledWith("2026-12-01");
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
    const { field, onChangeStartDate, onClose } = setup();
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onChangeStartDate).not.toHaveBeenCalled();
  });

  it("Esc leaves without saving", () => {
    const { field, onChangeStartDate, onClose } = setup();
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    fireEvent(screen.getByRole("dialog", { hidden: true }), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalled();
    expect(onChangeStartDate).not.toHaveBeenCalled();
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
    const { field, onChangeStartDate, onClose } = setup("2026-11-03");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(field().value).toBe("");
    expect(onChangeStartDate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChangeStartDate).toHaveBeenCalledWith(null);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("stays open with an error when the save fails, and can be saved again", async () => {
    const onChangeStartDate = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    const { field, onClose } = setup(undefined, onChangeStartDate);
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The date could not be saved");
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
