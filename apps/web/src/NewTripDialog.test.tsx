// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { NewTripDialog } from "./NewTripDialog";
import { renderApp, setPhone } from "./test-helpers";
import type { TripGeneration } from "./tripGeneration";

beforeEach(() => {
  setPhone(false);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(cleanup);

const generation = (fields: Partial<TripGeneration> = {}): TripGeneration => ({
  remaining: 3,
  running: false,
  failure: null,
  lastPrompt: "",
  start: vi.fn(async () => undefined),
  setWatching: vi.fn(),
  ...fields,
});
const open = (g?: TripGeneration, initialStep?: "ai") => {
  const handlers = { onCreate: vi.fn(async () => undefined), onCancel: vi.fn() };
  renderApp(<NewTripDialog generation={g} initialStep={initialStep} {...handlers} />);
  return handlers;
};

describe("New Trip", () => {
  it("is the Blank Trip form at once without AI (a guest)", () => {
    open();
    expect(screen.getByRole("heading", { name: "Blank Trip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("offers Blank Trip and Generate with AI, each with a way back", async () => {
    open(generation());
    expect(screen.getByRole("heading", { name: "New Trip" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Blank Trip/ }));
    expect(screen.getByRole("heading", { name: "Blank Trip" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("button", { name: /Generate with AI/ }));
    expect(screen.getByRole("heading", { name: "Generate with AI" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "New Trip" })).toBeTruthy();
  });

  it("generates from the prompt in the interface language; an example fills the prompt", async () => {
    const g = generation();
    open(g);
    await userEvent.click(screen.getByRole("button", { name: /Generate with AI/ }));
    expect(g.setWatching).toHaveBeenCalledWith(true);
    const generate = screen.getByRole("button", { name: "Generate Trip" });
    expect((generate as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "7 days in New Zealand by car" }));
    expect((screen.getByLabelText("Describe your trip") as HTMLTextAreaElement).value).toBe("7 days in New Zealand by car");
    await userEvent.click(generate);
    expect(g.start).toHaveBeenCalledWith({ prompt: "7 days in New Zealand by car", language: "en" });
  });

  it("opens on Generate with AI with the prompt that failed, to try it again", () => {
    open(generation({ failure: "failed", lastPrompt: "Kyoto, 3 days" }), "ai");
    expect((screen.getByLabelText("Describe your trip") as HTMLTextAreaElement).value).toBe("Kyoto, 3 days");
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
  });

  it("shows the limit instead of letting the user generate", async () => {
    open(generation({ remaining: 0 }));
    await userEvent.click(screen.getByRole("button", { name: /Generate with AI/ }));
    await userEvent.type(screen.getByLabelText("Describe your trip"), "Kyoto");
    expect(screen.getByRole("alert").textContent).toContain("Daily limit reached");
    expect((screen.getByRole("button", { name: "Generate Trip" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens on the running generation, which can be left", async () => {
    const handlers = open(generation({ running: true }));
    expect(screen.getByRole("heading", { name: "Creating your Trip" })).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(handlers.onCancel).toHaveBeenCalled();
  });

  it("says why the last generation failed, and when starting one failed", async () => {
    const start = vi.fn(async () => {
      throw new ApiError("Request failed: 500");
    });
    open(generation({ failure: "unusable", start }));
    await userEvent.click(screen.getByRole("button", { name: /Generate with AI/ }));
    expect(screen.getByRole("alert").textContent).toContain("Could not plan a Trip from this");
    cleanup();

    open(generation({ start }));
    await userEvent.click(screen.getByRole("button", { name: /Generate with AI/ }));
    await userEvent.type(screen.getByLabelText("Describe your trip"), "Kyoto");
    await userEvent.click(screen.getByRole("button", { name: "Generate Trip" }));
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
  });
});
