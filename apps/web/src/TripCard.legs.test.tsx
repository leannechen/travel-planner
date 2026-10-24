// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Leg, Place } from "@travel-planner/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getPlaces } from "./api";
import { TripCard } from "./TripCard";
import { PreferencesProvider } from "./preferences";
import { makeDay, makeEvent, makeTrip, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({ ApiError: (await importOriginal<typeof import("./api")>()).ApiError, insertDay: vi.fn(), deleteDay: vi.fn(), reorderDays: vi.fn(), restoreDay: vi.fn(), getPlaces: vi.fn() }));

const kyoto: Place = { id: "p1", name: "Kyoto Station", address: "Kyoto", area: "Kyoto", lat: 35, lng: 135 };
const kinkaku: Place = { id: "p2", name: "Kinkaku-ji", address: "Kyoto", area: "Kyoto", lat: 35.1, lng: 135.1 };

const a = makeEvent({ title: "Station", startMinute: 540, durationMinutes: 60, placeId: "p1" });
const b = makeEvent({ title: "Golden Pavilion", startMinute: 660, durationMinutes: 60, placeId: "p2" });
const c = makeEvent({ title: "Lunch idea", startMinute: 780, durationMinutes: 60 });

function setup(legs: Leg[] = [], events = [a, b, c]) {
  const day = makeDay(1, events);
  const trip = makeTrip({ days: [day], legs, travelMode: "walk" });
  const props = {
    trip,
    onOpenSettings: vi.fn(),
    onOpenTripList: vi.fn(),
    onDaysChange: vi.fn(),
    onSelectEvent: vi.fn(),
    onCreateAt: vi.fn(),
    onAddToBacklog: vi.fn(),
    onMove: vi.fn(),
    onCreateLeg: vi.fn().mockResolvedValue(undefined),
    onChangeLegMode: vi.fn().mockResolvedValue(undefined),
    onSetLegDuration: vi.fn().mockResolvedValue(undefined),
    onDeleteLeg: vi.fn().mockResolvedValue(undefined),
    onToast: vi.fn(),
    notesOpen: false,
    onToggleNotes: vi.fn(),
    onShowShortcuts: vi.fn(),
    onAddTodo: vi.fn(),
    onToggleTodo: vi.fn(),
    onDeleteTodo: vi.fn(),
  };
  renderApp(<TripCard {...props} />);
  return { props, dayId: day.id, ids: day.events.map((e) => e.id) };
}

const leg = (dayId: string, from: string, to: string, overrides: Partial<Leg> = {}): Leg => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  dayId,
  fromEventId: from,
  toEventId: to,
  mode: "transit",
  durationMinutes: 25,
  distanceMeters: 7400,
  manual: false,
  ...overrides,
});

beforeEach(() => {
  setPhone(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(getPlaces).mockResolvedValue([kyoto, kinkaku]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Leg slots", () => {
  it("offers a slot between two Events that both have a location, and none where one has not", () => {
    setup();
    expect(screen.getAllByRole("button", { name: /Add travel between/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add travel between Station and Golden Pavilion" })).toBeTruthy();
  });

  it("has no Add Event on hover, whose start could differ from where a click creates one", () => {
    setup();
    expect(screen.queryAllByRole("button", { name: /^Add Event / })).toHaveLength(0);
    // Before the first Event and after the last one there is nothing to offer.
    expect(document.querySelectorAll(".slot-row")).toHaveLength(1);
  });

  const touch = () =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: none)", media: query, addEventListener() {}, removeEventListener() {} }));
  const tap = (row: HTMLElement, clientY: number) => {
    (row.parentElement as HTMLElement).getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    fireEvent.click(row, { clientY });
  };

  it("on a touch screen the first tap only shows the buttons, and Add Event starts at the tapped minute", async () => {
    const user = userEvent.setup();
    touch();
    const { props, dayId } = setup();
    const row = document.querySelector(".slot-row") as HTMLElement;
    expect(screen.queryByRole("button", { name: /^Add Event / })).toBeNull();
    // The axis starts at 08:00 with 64px per hour: 150px down is 10:20, which the grid rounds down to 10:15.
    tap(row, 150);
    expect(props.onCreateAt).not.toHaveBeenCalled();
    expect(row.classList.contains("open")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Add Event between Station and Golden Pavilion" }));
    expect(props.onCreateAt).toHaveBeenCalledTimes(1);
    expect(props.onCreateAt).toHaveBeenCalledWith(dayId, 615);
  });

  it("on a touch screen a tap outside dismisses the buttons", async () => {
    const user = userEvent.setup();
    touch();
    setup();
    const row = document.querySelector(".slot-row") as HTMLElement;
    tap(row, 140);
    await user.click(document.body);
    expect(row.classList.contains("open")).toBe(false);
  });

  it("Esc dismisses the buttons shown by a tap", async () => {
    const user = userEvent.setup();
    touch();
    setup();
    const row = document.querySelector(".slot-row") as HTMLElement;
    tap(row, 140);
    await user.keyboard("{Escape}");
    expect(row.classList.contains("open")).toBe(false);
  });

  it("chooses the mode, starting with the Trip's default, and creates the Leg on OK", async () => {
    const user = userEvent.setup();
    const { props, ids } = setup();
    await user.click(screen.getByRole("button", { name: /Add travel between/ }));
    const dialog = screen.getByRole("dialog", { name: "Travel by" });
    expect(within(dialog).getByRole("button", { name: "Walk" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(dialog).getByRole("button", { name: "Drive" }));
    await user.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(props.onCreateLeg).toHaveBeenCalledWith({ fromEventId: ids[0], toEventId: ids[1], mode: "drive" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("creates nothing on Cancel, and Esc closes the chooser", async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole("button", { name: /Add travel between/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Add travel between/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onCreateLeg).not.toHaveBeenCalled();
  });

  it("shows the server's message and stays open when the Leg cannot be created", async () => {
    const user = userEvent.setup();
    const { props } = setup();
    props.onCreateLeg.mockRejectedValueOnce(new Error("Travel times are not available right now"));
    await user.click(screen.getByRole("button", { name: /Add travel between/ }));
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Travel times are not available right now");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("Legs on the timeline", () => {
  function withLeg(overrides: Partial<Leg> = {}) {
    const day = makeDay(1, [a, b, c]);
    const [ea, eb] = day.events;
    const trip = makeTrip({ days: [day], legs: [leg(day.id, ea!.id, eb!.id, overrides)], travelMode: "walk" });
    const props = {
      trip,
      onDaysChange: vi.fn(),
      onSelectEvent: vi.fn(),
      onCreateAt: vi.fn(),
      onAddToBacklog: vi.fn(),
      onMove: vi.fn(),
      onCreateLeg: vi.fn(),
      onChangeLegMode: vi.fn().mockResolvedValue(undefined),
      onSetLegDuration: vi.fn().mockResolvedValue(undefined),
      onDeleteLeg: vi.fn().mockResolvedValue(undefined),
      onToast: vi.fn(),
      notesOpen: false,
      onToggleNotes: vi.fn(),
      onShowShortcuts: vi.fn(),
      onAddTodo: vi.fn(),
      onToggleTodo: vi.fn(),
      onDeleteTodo: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenTripList: vi.fn(),
    };
    const rendered = renderApp(<TripCard {...props} />);
    return { ...props, rerenderWith: (next: typeof trip) => rendered.rerender(<PreferencesProvider><TripCard {...props} trip={next} /></PreferencesProvider>) };
  }

  it("shows the mode and duration, and the detail on click", async () => {
    const user = userEvent.setup();
    cleanup();
    withLeg();
    const pill = screen.getByRole("button", { name: "Transit, 25 min. Open the Travel" });
    expect(pill.textContent).toContain("25 min");
    // The Leg takes the place of the slot.
    expect(screen.queryByRole("button", { name: /Add travel between/ })).toBeNull();
    expect(document.querySelectorAll(".slot-row")).toHaveLength(0);
    await user.click(pill);
    const dialog = screen.getByRole("dialog", { name: "Travel · 25 min" });
    expect(within(dialog).getByText("Station")).toBeTruthy();
    expect(within(dialog).getByText("Golden Pavilion")).toBeTruthy();
    expect(within(dialog).getByText("25 min · 7.4 km")).toBeTruthy();
    // The gap between 10:00 and 11:00.
    expect(within(dialog).getByText("1 h")).toBeTruthy();
    expect(within(dialog).queryByText(/Gap is shorter/)).toBeNull();
  });

  it("links to the route in Google Maps with the two places", async () => {
    const user = userEvent.setup();
    cleanup();
    withLeg();
    await user.click(screen.getByRole("button", { name: /Open the Travel/ }));
    const link = (await screen.findByRole("link", { name: "Open in Google Maps" })) as HTMLAnchorElement;
    const url = new URL(link.href);
    expect(url.searchParams.get("origin_place_id")).toBe("p1");
    expect(url.searchParams.get("destination_place_id")).toBe("p2");
    expect(url.searchParams.get("travelmode")).toBe("transit");
  });

  it("warns when the gap is shorter than the trip", async () => {
    const user = userEvent.setup();
    cleanup();
    withLeg({ durationMinutes: 90 });
    const pill = screen.getByRole("button", { name: /Open the Travel/ });
    expect(pill.textContent).toContain("1 h 30 min · gap 1 h");
    await user.click(pill);
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toContain("Gap is shorter than the trip");
  });

  it("shows 'Can't calculate' for a Drive Leg with no route, with the map link and a minutes field", async () => {
    const user = userEvent.setup();
    cleanup();
    withLeg({ mode: "drive", durationMinutes: null, distanceMeters: null });
    const pill = screen.getByRole("button", { name: /Open the Travel/ });
    expect(pill.textContent).toContain("Can't calculate");
    await user.click(pill);
    const dialog = screen.getByRole("dialog", { name: "Travel · can't calculate" });
    expect(within(dialog).getByText("—")).toBeTruthy();
    expect(within(dialog).getByText(/No route was found/)).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Open in Google Maps" })).toBeTruthy();
    expect(within(dialog).getByRole("textbox", { name: "Duration (minutes)" })).toBeTruthy();
  });

  it("explains a transit Leg with no route, and saves the minutes entered", async () => {
    const user = userEvent.setup();
    cleanup();
    const props = withLeg({ mode: "transit", durationMinutes: null, distanceMeters: null });
    await user.click(screen.getByRole("button", { name: /Open the Travel/ }));
    const dialog = screen.getByRole("dialog", { name: "Travel · can't calculate" });
    expect(within(dialog).getByText(/Google gives no public-transit routes in some countries/)).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Open in Google Maps" })).toBeTruthy();
    expect(within(dialog).getByText("Whole minutes, 1 to 1,440.")).toBeTruthy();
    // Not Clear or Cancel while there is nothing to clear.
    expect(within(dialog).queryByRole("button", { name: "Clear duration" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
    await user.type(within(dialog).getByRole("textbox", { name: "Duration (minutes)" }), "25{Enter}");
    expect(props.onSetLegDuration).toHaveBeenCalledWith(props.trip.legs[0], 25);
  });

  it("refuses minutes outside 1 to 1,440 under the field", async () => {
    const user = userEvent.setup();
    cleanup();
    const props = withLeg({ mode: "transit", durationMinutes: null, distanceMeters: null });
    await user.click(screen.getByRole("button", { name: /Open the Travel/ }));
    const field = screen.getByRole("textbox", { name: "Duration (minutes)" });
    for (const typed of ["0", "1441", "2.5", "abc"]) {
      await user.clear(field);
      await user.type(field, typed);
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByRole("alert").textContent).toBe("Enter whole minutes from 1 to 1,440.");
    }
    expect(props.onSetLegDuration).not.toHaveBeenCalled();
  });

  it("shows a duration entered by hand with a pencil on the Leg, 'Entered by you' and Edit", async () => {
    const user = userEvent.setup();
    cleanup();
    withLeg({ mode: "transit", durationMinutes: 25, distanceMeters: null, manual: true });
    const pill = screen.getByRole("button", { name: "Transit, 25 min, entered by you. Open the Travel" });
    expect(pill.querySelector(".leg-manual-mark")).not.toBeNull();
    await user.click(pill);
    const dialog = screen.getByRole("dialog", { name: "Travel · 25 min" });
    expect(within(dialog).getByRole("tooltip").textContent).toBe("Entered by you");
    expect(within(dialog).getByRole("button", { name: "Edit the duration" })).toBeTruthy();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).getByRole("link", { name: "Open in Google Maps" })).toBeTruthy();
  });

  it("edits a duration entered by hand: Save, Cancel, Esc and Clear duration", async () => {
    const user = userEvent.setup();
    cleanup();
    const props = withLeg({ mode: "transit", durationMinutes: 25, distanceMeters: null, manual: true });
    await user.click(screen.getByRole("button", { name: /Open the Travel/ }));
    await user.click(screen.getByRole("button", { name: "Edit the duration" }));
    const field = screen.getByRole("textbox", { name: "Duration (minutes)" });
    expect((field as HTMLInputElement).value).toBe("25");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(within(screen.getByRole("dialog")).queryByRole("textbox")).toBeNull();

    // Esc leaves editing, not the popover.
    await user.click(screen.getByRole("button", { name: "Edit the duration" }));
    await user.keyboard("{Escape}");
    expect(within(screen.getByRole("dialog")).queryByRole("textbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit the duration" }));
    await user.clear(screen.getByRole("textbox", { name: "Duration (minutes)" }));
    await user.type(screen.getByRole("textbox", { name: "Duration (minutes)" }), "40");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSetLegDuration).toHaveBeenLastCalledWith(props.trip.legs[0], 40);

    await user.click(screen.getByRole("button", { name: "Edit the duration" }));
    await user.click(screen.getByRole("button", { name: "Clear duration" }));
    expect(props.onSetLegDuration).toHaveBeenLastCalledWith(props.trip.legs[0], null);
  });

  it("keeps a duration entered by hand when its own mode is chosen again", async () => {
    const user = userEvent.setup();
    cleanup();
    const props = withLeg({ mode: "transit", durationMinutes: 25, distanceMeters: null, manual: true });
    await user.click(screen.getByRole("button", { name: /Open the Travel/ }));
    // The current mode has the focus when the popover opens.
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Transit" }));
    expect(props.onChangeLegMode).not.toHaveBeenCalled();
  });

  it("says so when the Leg was calculated in the meantime", async () => {
    const user = userEvent.setup();
    cleanup();
    const props = withLeg({ mode: "transit", durationMinutes: null, distanceMeters: null });
    props.onSetLegDuration.mockRejectedValueOnce(new ApiError("Only a Leg ...", "leg_calculated"));
    await user.click(screen.getByRole("button", { name: /Open the Travel/ }));
    await user.type(screen.getByRole("textbox", { name: "Duration (minutes)" }), "25{Enter}");
    expect((await screen.findByRole("alert")).textContent).toBe("This Travel has a calculated duration now, so it takes no minutes by hand.");
  });

  it("moves up when it grows near the bottom of the window, so the minutes field is not cut off", async () => {
    const user = userEvent.setup();
    cleanup();
    let resized: (() => void) | undefined;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} unobserve() {} disconnect() {} });
    withLeg({ mode: "transit", durationMinutes: 25, distanceMeters: null, manual: true });
    const pill = screen.getByRole("button", { name: /Open the Travel/ });
    pill.getBoundingClientRect = () => ({ top: 700, bottom: 722, left: 100, right: 180, width: 80, height: 22, x: 100, y: 700, toJSON() {} });
    await user.click(pill);
    const popover = screen.getByRole("dialog");
    expect(popover.style.top).toBe("692px");
    await user.click(screen.getByRole("button", { name: "Edit the duration" }));
    Object.defineProperty(popover, "offsetHeight", { configurable: true, value: 400 });
    act(() => resized?.());
    expect(popover.style.top).toBe(`${window.innerHeight - 400 - 8}px`);
  });

  it("warns with the entered duration when the gap is shorter", async () => {
    const user = userEvent.setup();
    cleanup();
    withLeg({ mode: "transit", durationMinutes: 90, distanceMeters: null, manual: true });
    await user.click(screen.getByRole("button", { name: /Open the Travel/ }));
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toContain("The trip takes 1 h 30 min (entered by you).");
  });

  it("changes the mode at once and deletes without asking", async () => {
    const user = userEvent.setup();
    cleanup();
    const props = withLeg();
    await user.click(screen.getByRole("button", { name: /Open the Travel/ }));
    await user.click(screen.getByRole("button", { name: "Drive" }));
    expect(props.onChangeLegMode).toHaveBeenCalledWith(props.trip.legs[0], "drive");
    await user.click(screen.getByRole("button", { name: "Delete Travel" }));
    expect(props.onDeleteLeg).toHaveBeenCalledWith(props.trip.legs[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on a click elsewhere, and Esc closes it without clearing the selection", async () => {
    const user = userEvent.setup();
    cleanup();
    withLeg();
    await user.click(screen.getByRole("button", { name: /Open the Travel/ }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Open the Travel/ }));
    const reachedPage = vi.fn();
    window.addEventListener("keydown", reachedPage);
    await user.keyboard("{Escape}");
    window.removeEventListener("keydown", reachedPage);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reachedPage).not.toHaveBeenCalled();
  });

  it("closes when the two Events stop being adjacent", async () => {
    const user = userEvent.setup();
    cleanup();
    const props = withLeg();
    await user.click(screen.getByRole("button", { name: /Open the Travel/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Another Event lands between the two; the server's answer drops the Leg.
    const day = props.trip.days[0]!;
    const between = makeEvent({ title: "Between", startMinute: 600, durationMinutes: 30, dayId: day.id });
    props.rerenderWith({ ...props.trip, days: [{ ...day, events: [...day.events, between] }], legs: [] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
