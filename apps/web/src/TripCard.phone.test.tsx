// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertDay } from "./api";
import { TripCard } from "./TripCard";
import { makeDay, makeEvent, makeTrip, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", () => ({ insertDay: vi.fn(), deleteDay: vi.fn(), reorderDays: vi.fn(), restoreDay: vi.fn() }));

const trip = makeTrip({
  days: [makeDay(1, [makeEvent({ title: "Fushimi Inari" })]), makeDay(2, [makeEvent({ title: "Nara Park" })])],
  backlog: [makeEvent({ title: "Dinner idea" })],
  archive: [makeEvent({ title: "Old plan", holding: "archive" })],
});

function setup(selectedEventId?: string) {
  const props = {
    trip,
    onDaysChange: vi.fn(),
    selectedEventId,
    onSelectEvent: vi.fn(),
    onCreateAt: vi.fn(),
    onAddToBacklog: vi.fn(),
    onMove: vi.fn(),
    onCreateLeg: vi.fn(),
    onChangeLegMode: vi.fn(),
    onDeleteLeg: vi.fn(),
    onToast: vi.fn(),
    notesOpen: false,
    onToggleNotes: vi.fn(),
    onShowShortcuts: vi.fn(),
    onAddTodo: vi.fn(),
    onToggleTodo: vi.fn(),
    onDeleteTodo: vi.fn(),
  };
  renderApp(<TripCard {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TripCard on a phone", () => {
  beforeEach(() => setPhone(true));

  it("shows one Day at a time, chosen from the tabs", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByText("Fushimi Inari")).toBeTruthy();
    expect(screen.queryByText("Nara Park")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Day 2" }));
    expect(screen.getByText("Nara Park")).toBeTruthy();
    expect(screen.queryByText("Fushimi Inari")).toBeNull();
    expect(screen.getByRole("button", { name: "Day 2" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("brings the Day of the selected Event into view", () => {
    setup(trip.days[1]!.events[0]!.id);
    expect(screen.getByText("Nara Park")).toBeTruthy();
    expect(screen.queryByText("Fushimi Inari")).toBeNull();
  });

  it("adds a Day at the end from the tab", async () => {
    const user = userEvent.setup();
    const newDay = makeDay(3, [makeEvent({ title: "Arashiyama" })]);
    vi.mocked(insertDay).mockResolvedValue([...trip.days, newDay]);
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Add a Day" }));
    await waitFor(() => expect(props.onDaysChange).toHaveBeenCalled());
    expect(insertDay).toHaveBeenCalledWith(trip.id, 3);
  });

  it("keeps the lists in drawers that open from the bottom bar", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByText("Dinner idea")).toBeNull();
    const bar = screen.getByRole("navigation", { name: "Backlog, Archive and Todos" });
    await user.click(within(bar).getByRole("button", { name: /Backlog/ }));
    expect(screen.getByText("Dinner idea")).toBeTruthy();
    expect(screen.queryByText("Old plan")).toBeNull();
    // Another tab replaces the drawer; the same tab closes it.
    await user.click(within(bar).getByRole("button", { name: /Archive/ }));
    expect(screen.getByText("Old plan")).toBeTruthy();
    expect(screen.queryByText("Dinner idea")).toBeNull();
    await user.click(within(bar).getByRole("button", { name: /Archive/ }));
    expect(screen.queryByText("Old plan")).toBeNull();
  });

  it("closes a drawer with Escape and with a tap on the background", async () => {
    const user = userEvent.setup();
    setup();
    const bar = screen.getByRole("navigation", { name: "Backlog, Archive and Todos" });
    await user.click(within(bar).getByRole("button", { name: /Backlog/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Dinner idea")).toBeNull();
    await user.click(within(bar).getByRole("button", { name: /Backlog/ }));
    await user.click(document.querySelector(".drawer-scrim")!);
    expect(screen.queryByText("Dinner idea")).toBeNull();
  });

  it("closes the drawer when an Event is chosen from it", async () => {
    const user = userEvent.setup();
    const props = setup();
    const bar = screen.getByRole("navigation", { name: "Backlog, Archive and Todos" });
    await user.click(within(bar).getByRole("button", { name: /Backlog/ }));
    await user.click(screen.getByText("Dinner idea"));
    expect(props.onSelectEvent).toHaveBeenCalledWith(trip.backlog[0]!.id);
    expect(screen.queryByText("Dinner idea")).toBeNull();
  });

  it("links each tab to its drawer", async () => {
    const user = userEvent.setup();
    setup();
    const bar = screen.getByRole("navigation", { name: "Backlog, Archive and Todos" });
    const tab = within(bar).getByRole("button", { name: /Todos/ });
    await user.click(tab);
    expect(document.getElementById(tab.getAttribute("aria-controls")!)).toBeTruthy();
    expect(tab.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("TripCard on a desktop", () => {
  it("shows every Day and the lists side by side, without tabs or a bottom bar", () => {
    setPhone(false);
    setup();
    expect(screen.getByText("Fushimi Inari")).toBeTruthy();
    expect(screen.getByText("Nara Park")).toBeTruthy();
    expect(screen.getByText("Dinner idea")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Days" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Backlog, Archive and Todos" })).toBeNull();
  });
});
