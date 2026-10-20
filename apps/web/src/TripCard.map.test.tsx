// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripCard } from "./TripCard";
import { makeDay, makeTrip, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", () => ({ insertDay: vi.fn(), deleteDay: vi.fn(), reorderDays: vi.fn(), restoreDay: vi.fn(), getPlaces: vi.fn(async () => []), getOpeningHours: vi.fn(async () => new Map()) }));

function setup(selectedEventId?: string) {
  renderApp(
    <TripCard
      selectedEventId={selectedEventId}
      trip={makeTrip({ days: [makeDay(1)] })}
      onOpenSettings={vi.fn()}
      onOpenTripList={vi.fn()}
      onDaysChange={vi.fn()}
      onSelectEvent={vi.fn()}
      onCreateAt={vi.fn()}
      onAddToBacklog={vi.fn()}
      onMove={vi.fn()}
      onCreateLeg={vi.fn()}
      onChangeLegMode={vi.fn()}
      onDeleteLeg={vi.fn()}
      onToast={vi.fn()}
      notesOpen={false}
      onToggleNotes={vi.fn()}
      onShowShortcuts={vi.fn()}
      onAddTodo={vi.fn()}
      onToggleTodo={vi.fn()}
      onDeleteTodo={vi.fn()}
      footer={<p>Language and theme</p>}
    />,
  );
}

beforeEach(() => {
  setPhone(false);
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Schedule and Map switch", () => {
  it("starts on the schedule and switches to the map and back", () => {
    setup();
    expect(screen.getByText("Day 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByTestId("fake-map")).toBeTruthy();
    expect(screen.queryByText("Backlog", { selector: "h3" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.queryByTestId("fake-map")).toBeNull();
  });

  it("marks only the Trip that owns the open panel, so the layout rules reach no other Trip", () => {
    setup("00000000-0000-4000-8000-0000000000aa");
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    const workspace = screen.getByTestId("fake-map").closest(".workspace")!;
    expect(workspace.classList.contains("map-mode")).toBe(true);
    expect(workspace.classList.contains("has-selection")).toBe(true);
    cleanup();
    setup();
    expect(document.querySelector(".workspace")!.classList.contains("has-selection")).toBe(false);
  });

  it("keeps the language and theme switches in both views", () => {
    setup();
    expect(screen.getByText("Language and theme")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByText("Language and theme")).toBeTruthy();
  });
});
