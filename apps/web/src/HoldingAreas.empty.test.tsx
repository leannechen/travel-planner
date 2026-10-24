// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldingAreas } from "./HoldingAreas";
import { renderApp, setPhone } from "./test-helpers";

beforeEach(() => {
  setPhone(false);
  localStorage.clear();
});
afterEach(cleanup);

function setup(viewer = false) {
  const onAddToBacklog = vi.fn();
  const fn = vi.fn();
  renderApp(<HoldingAreas backlog={[]} archive={[]} onSelectEvent={fn} onAddToBacklog={onAddToBacklog} onMoveTo={fn} viewer={viewer} />);
  return { onAddToBacklog };
}

describe("empty Backlog and Archive (design 28)", () => {
  it("shows a title, a line of help and an Add to Backlog action in the Backlog", async () => {
    const { onAddToBacklog } = setup();
    expect(screen.getByText("No ideas parked")).toBeTruthy();
    // The header's + button has the same name; the action in the empty state comes last.
    await userEvent.click(screen.getAllByRole("button", { name: "Add to Backlog" }).at(-1)!);
    expect(onAddToBacklog).toHaveBeenCalled();
  });

  it("shows a title and help, with no action, in the Archive", () => {
    setup();
    expect(screen.getByText("Nothing archived")).toBeTruthy();
    expect(screen.getByText(/Events you give up on go here/)).toBeTruthy();
  });

  it("has no action for a Viewer", () => {
    setup(true);
    expect(screen.getByText("No ideas parked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add to Backlog" })).toBeNull();
  });
});
