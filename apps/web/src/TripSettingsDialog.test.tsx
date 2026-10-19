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

  it("saves a date when typing stops, and says so", async () => {
    const { field, onChangeStartDate } = setup();
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    expect(onChangeStartDate).not.toHaveBeenCalled();
    await waitFor(() => expect(onChangeStartDate).toHaveBeenCalledWith("2026-12-01"), { timeout: 2000 });
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("saves only the final date when a year is typed digit by digit", async () => {
    const { field, onChangeStartDate } = setup();
    for (const value of ["0002-11-03", "0020-11-03", "0202-11-03", "2026-11-03"]) fireEvent.change(field(), { target: { value } });
    fireEvent.blur(field());
    await waitFor(() => expect(onChangeStartDate).toHaveBeenCalledTimes(1));
    expect(onChangeStartDate).toHaveBeenCalledWith("2026-11-03");
  });

  it("saves a typed date when the dialog is closed at once", async () => {
    const { field, onChangeStartDate, onClose } = setup();
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onChangeStartDate).toHaveBeenCalledWith("2026-12-01");
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open with the error when the save fails on close, and tries again on the next close", async () => {
    const onChangeStartDate = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    const { field, onClose } = setup(undefined, onChangeStartDate);
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChangeStartDate).toHaveBeenCalledTimes(2);
  });

  it("does not clear the date when the field is emptied while typing", () => {
    const { field, onChangeStartDate } = setup("2026-11-03");
    fireEvent.change(field(), { target: { value: "" } });
    expect(onChangeStartDate).not.toHaveBeenCalled();
  });

  it("clears the date with Clear", async () => {
    const { field, onChangeStartDate } = setup("2026-11-03");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChangeStartDate).toHaveBeenCalledWith(null);
    await waitFor(() => expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(true));
    expect(field().value).toBe("");
  });

  it("says when the date could not be saved", async () => {
    const { field } = setup(undefined, vi.fn(async () => Promise.reject(new Error("down"))));
    fireEvent.change(field(), { target: { value: "2026-12-01" } });
    fireEvent.blur(field());
    expect((await screen.findByRole("alert")).textContent).toBe("The date could not be saved");
  });

  it("closes", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
