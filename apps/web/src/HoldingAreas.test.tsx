// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoldingAreas } from "./HoldingAreas";
import { makeEvent, renderApp } from "./test-helpers";

afterEach(cleanup);

function show() {
  const backlogged = makeEvent({ title: "Nishiki Market", holding: "backlog" });
  const archived = makeEvent({ title: "Tokyo Tower", holding: "archive" });
  renderApp(
    <HoldingAreas backlog={[backlogged]} archive={[archived]} onSelectEvent={vi.fn()} onAddToBacklog={vi.fn()} onMoveTo={vi.fn()} />,
  );
}

describe("a card in a holding area", () => {
  it("has no button in the Backlog: an Event is scheduled by dragging it", () => {
    show();
    const card = screen.getByText("Nishiki Market").closest("li")!;
    // Only the button that opens the Event.
    expect(within(card).getAllByRole("button")).toHaveLength(1);
  });

  it("can be moved back to the Backlog from the Archive", () => {
    show();
    const card = screen.getByText("Tokyo Tower").closest("li")!;
    expect(within(card).getByRole("button", { name: "Back to Backlog" })).toBeTruthy();
  });
});
