// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTrip, renderApp } from "./test-helpers";
import { TripListDialog } from "./TripListDialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(cleanup);

const kyoto = makeTrip({ title: "Kyoto & Osaka" });
const taipei = makeTrip({ title: "Taipei weekend" });

function setup(onCreate = vi.fn(async () => undefined)) {
  const handlers = { onSwitch: vi.fn(), onCreate, onClose: vi.fn() };
  renderApp(<TripListDialog trips={[kyoto, taipei]} currentId={kyoto.id} {...handlers} />);
  return handlers;
}

describe("Trip list", () => {
  it("lists the Trips and marks the one shown", () => {
    setup();
    expect(screen.getByRole("button", { name: /Kyoto & Osaka/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /Taipei weekend/ }).getAttribute("aria-current")).toBeNull();
  });

  it("switches to the Trip that is clicked", async () => {
    const { onSwitch } = setup();
    await userEvent.click(screen.getByRole("button", { name: /Taipei weekend/ }));
    expect(onSwitch).toHaveBeenCalledWith(taipei.id);
  });

  it("creates a Trip from its title", async () => {
    const { onCreate } = setup();
    await userEvent.type(screen.getByLabelText("Trip title"), "Seoul");
    await userEvent.click(screen.getByRole("button", { name: "New Trip" }));
    expect(onCreate).toHaveBeenCalledWith("Seoul");
  });

  it("closes with the Close button", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
