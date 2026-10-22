// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripCard } from "./TripCard";
import { makeDay, makeEvent, makeTrip, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", () => ({ insertDay: vi.fn(), deleteDay: vi.fn(), reorderDays: vi.fn(), restoreDay: vi.fn() }));

const trip = makeTrip({
  days: [makeDay(1, [makeEvent({ title: "Fushimi Inari" })])],
  backlog: [makeEvent({ title: "Dinner idea" })],
  archive: [makeEvent({ title: "Old plan", holding: "archive" })],
});

function setup() {
  const fn = vi.fn();
  const props = { onAddToBacklog: vi.fn() };
  renderApp(
    <TripCard
      trip={trip}
      onOpenSettings={fn}
      onOpenTripList={fn}
      onDaysChange={fn}
      onSelectEvent={fn}
      onCreateAt={fn}
      onAddToBacklog={props.onAddToBacklog}
      onMove={fn}
      onCreateLeg={fn}
      onChangeLegMode={fn}
      onDeleteLeg={fn}
      onToast={fn}
      notesOpen={false}
      onToggleNotes={fn}
      onShowShortcuts={fn}
      onAddTodo={fn}
      onToggleTodo={fn}
      onDeleteTodo={fn}
    />,
  );
  return props;
}

beforeEach(() => {
  setPhone(false);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("collapsible side panels", () => {
  it("collapses and reopens the Backlog and Archive, and keeps the choice", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(within(screen.getByRole("complementary", { name: "Holding areas" })).getByRole("button", { name: "Collapse panel" }));
    expect(screen.queryByText("Dinner idea")).toBeNull();
    expect(localStorage.getItem("travel-planner.collapsed.backlog")).toBe("1");
    expect(localStorage.getItem("travel-planner.collapsed.archive")).toBe("1");
    // The strip icons are drop targets.
    expect(screen.getByRole("button", { name: "Backlog 1" }).getAttribute("data-drop")).toBe("backlog");
    expect(screen.getByRole("button", { name: "Archive 1" }).getAttribute("data-drop")).toBe("archive");
    await user.click(screen.getByRole("button", { name: "Backlog 1" }));
    expect(screen.getByText("Dinner idea")).toBeTruthy();
    expect(localStorage.getItem("travel-planner.collapsed.backlog")).toBe("0");
  });

  it("does not collapse the Backlog when an Event is added to it", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Add to Backlog" }));
    expect(props.onAddToBacklog).toHaveBeenCalled();
    expect(screen.getByText("Dinner idea")).toBeTruthy();
    expect(localStorage.getItem("travel-planner.collapsed.backlog")).not.toBe("1");
  });

  it("collapses the Todos panel to a strip and opens it again", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(within(screen.getByRole("complementary", { name: "Todos" })).getByRole("button", { name: "Collapse panel" }));
    expect(localStorage.getItem("travel-planner.collapsed.todos")).toBe("1");
    expect(screen.getByRole("button", { name: /^Todos \d+$/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Expand panel" }));
    expect(localStorage.getItem("travel-planner.collapsed.todos")).toBe("0");
  });
});
