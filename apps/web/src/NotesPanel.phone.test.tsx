// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesPanel } from "./NotesPanel";
import { renderApp, setPhone } from "./test-helpers";

function setup() {
  const props = {
    tripId: "00000000-0000-4000-8000-0000000000aa",
    notes: [],
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    closeRef: { current: undefined },
  };
  renderApp(<NotesPanel {...props} />);
  return props;
}

// jsdom has no ResizeObserver, which the panel uses to stay in view.
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("NotesPanel", () => {
  it("on a phone dims the page, and a tap on it closes the panel", async () => {
    setPhone(true);
    const props = setup();
    await userEvent.setup().click(document.querySelector(".notes-scrim")!);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("on a desktop has no scrim", () => {
    setPhone(false);
    setup();
    expect(screen.getByRole("region", { name: "Notes" })).toBeTruthy();
    expect(document.querySelector(".notes-scrim")).toBeNull();
  });
});
