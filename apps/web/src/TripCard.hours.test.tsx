// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { daily } from "@travel-planner/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOpeningHours } from "./api";
import { TripCard } from "./TripCard";
import { makeDay, makeEvent, makeTrip, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", () => ({ insertDay: vi.fn(), deleteDay: vi.fn(), reorderDays: vi.fn(), restoreDay: vi.fn(), getPlaces: vi.fn(async () => []), getOpeningHours: vi.fn() }));

const onTime = makeEvent({ title: "Morning visit", startMinute: 600, durationMinutes: 60, placeId: "fake:kinkaku-ji", openingHoursOn: true });
const late = makeEvent({ title: "Evening visit", startMinute: 18 * 60, durationMinutes: 60, placeId: "fake:kinkaku-ji", openingHoursOn: true });
const off = makeEvent({ title: "Not asked", startMinute: 20 * 60, durationMinutes: 60, placeId: "fake:kinkaku-ji", openingHoursOn: false });
const lodging = makeEvent({ title: "Inn", kind: "lodging", nights: 1, startMinute: 20 * 60, placeId: "fake:kinkaku-ji", openingHoursOn: true });

function setup(events = [onTime, late, off]) {
  const trip = makeTrip({ days: [makeDay(1, events)], startDate: "2026-11-03" });
  renderApp(
    <TripCard
      trip={trip}
      onOpenSettings={vi.fn()}
      onOpenTripList={vi.fn()}
      onDaysChange={vi.fn()}
      onSelectEvent={vi.fn()}
      onCreateAt={vi.fn()}
      onAddToBacklog={vi.fn()}
      onMove={vi.fn()}
      onCreateLeg={vi.fn()}
      onChangeLegMode={vi.fn()}
      onSetLegDuration={vi.fn()}
      onDeleteLeg={vi.fn()}
      onToast={vi.fn()}
      notesOpen={false}
      onToggleNotes={vi.fn()}
      onShowShortcuts={vi.fn()}
      onAddTodo={vi.fn()}
      onToggleTodo={vi.fn()}
      onDeleteTodo={vi.fn()}
    />,
  );
}

beforeEach(() => {
  setPhone(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(getOpeningHours).mockResolvedValue(new Map([["fake:kinkaku-ji", daily(540, 1020)]]));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const card = (title: string) => screen.getByText(title).closest(".event-card")!;

describe("Event cards and opening hours", () => {
  it("marks only an Event whose time does not fit the hours it asked for", async () => {
    setup();
    await waitFor(() => expect(card("Evening visit").classList.contains("warn")).toBe(true));
    expect(card("Evening visit").textContent).toContain("Opening hours may conflict");
    expect(card("Morning visit").classList.contains("warn")).toBe(false);
    expect(card("Not asked").classList.contains("warn")).toBe(false);
  });

  it("asks only for the places of Events that have opening hours on", async () => {
    setup([off]);
    expect(getOpeningHours).not.toHaveBeenCalled();
    cleanup();
    setup([late, onTime, lodging]);
    await waitFor(() => expect(getOpeningHours).toHaveBeenCalledWith(["fake:kinkaku-ji"]));
  });

  it("shows no label when the server has no hours for the place", async () => {
    vi.mocked(getOpeningHours).mockResolvedValue(new Map());
    setup();
    await waitFor(() => expect(getOpeningHours).toHaveBeenCalled());
    expect(card("Evening visit").classList.contains("warn")).toBe(false);
  });

  it("shows no label when the request fails", async () => {
    vi.mocked(getOpeningHours).mockRejectedValue(new Error("502"));
    setup();
    await waitFor(() => expect(getOpeningHours).toHaveBeenCalled());
    expect(card("Evening visit").classList.contains("warn")).toBe(false);
  });
});

describe("Trip dates on the Trip", () => {
  const render = (startDate: string | null, days = 3) => {
    cleanup();
    const trip = makeTrip({ days: Array.from({ length: days }, (_, i) => makeDay(i + 1)), startDate });
    const onOpenSettings = vi.fn();
    renderApp(
      <TripCard
        trip={trip}
        onOpenSettings={onOpenSettings}
        onOpenTripList={vi.fn()}
        onDaysChange={vi.fn()}
        onSelectEvent={vi.fn()}
        onCreateAt={vi.fn()}
        onAddToBacklog={vi.fn()}
        onMove={vi.fn()}
        onCreateLeg={vi.fn()}
        onChangeLegMode={vi.fn()}
        onSetLegDuration={vi.fn()}
        onDeleteLeg={vi.fn()}
        onToast={vi.fn()}
        notesOpen={false}
        onToggleNotes={vi.fn()}
        onShowShortcuts={vi.fn()}
        onAddTodo={vi.fn()}
        onToggleTodo={vi.fn()}
        onDeleteTodo={vi.fn()}
      />,
    );
    return onOpenSettings;
  };

  it("shows each Day's date and weekday, and the range with the day count", () => {
    render("2026-11-03");
    expect(screen.getByText("11/03・Tue")).toBeTruthy();
    expect(screen.getByText("11/05・Thu")).toBeTruthy();
    expect(screen.getByText("11/03 (Tue) - 11/05 (Thu) · 3 days")).toBeTruthy();
  });

  it("shows only Day numbers and the day count without a start date", () => {
    render(null);
    expect(screen.queryByText(/11\/0/)).toBeNull();
    expect(screen.getByText("3 days")).toBeTruthy();
  });

  it("opens Trip settings from the gear button", async () => {
    const onOpenSettings = render(null);
    screen.getByRole("button", { name: "Trip settings" }).click();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("puts the date under the Day name on phone tabs", () => {
    setPhone(true);
    render("2026-11-03");
    expect(screen.getByRole("button", { name: /Day 2/ }).textContent).toContain("11/04");
  });
});
