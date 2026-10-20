// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Leg, Place } from "@travel-planner/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlaces } from "./api";
import { TripCard } from "./TripCard";
import { PreferencesProvider } from "./preferences";
import { makeDay, makeEvent, makeTrip, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", () => ({ insertDay: vi.fn(), deleteDay: vi.fn(), reorderDays: vi.fn(), restoreDay: vi.fn(), getPlaces: vi.fn() }));

const kyoto: Place = { id: "p1", name: "Kyoto Station", address: "Kyoto", lat: 35, lng: 135 };
const kinkaku: Place = { id: "p2", name: "Kinkaku-ji", address: "Kyoto", lat: 35.1, lng: 135.1 };

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

  it("offers Add Event in every empty stretch, and Add Travel only where both Events have a location", () => {
    setup();
    // Before the first Event, between each pair, and after the last one.
    expect(screen.getAllByRole("button", { name: /^Add Event / })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Add Event before Station" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Event after Lunch idea" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Add travel between/ })).toHaveLength(1);
  });

  it("Add Event creates at the end of the Event before the gap", async () => {
    const user = userEvent.setup();
    const { props, dayId } = setup();
    await user.click(screen.getByRole("button", { name: "Add Event between Station and Golden Pavilion" }));
    expect(props.onCreateAt).toHaveBeenCalledTimes(1);
    expect(props.onCreateAt).toHaveBeenCalledWith(dayId, 600);
  });

  it("on a touch screen the first tap only shows the buttons", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: none)", media: query, addEventListener() {}, removeEventListener() {} }));
    const { props } = setup();
    const add = screen.getByRole("button", { name: "Add Event between Station and Golden Pavilion" });
    await user.click(add);
    expect(props.onCreateAt).not.toHaveBeenCalled();
    expect(add.closest(".slot-row")?.classList.contains("open")).toBe(true);
    await user.click(add);
    expect(props.onCreateAt).toHaveBeenCalledTimes(1);
  });

  it("on a touch screen Add Event starts at the minute that was tapped", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: none)", media: query, addEventListener() {}, removeEventListener() {} }));
    const { props, dayId } = setup();
    const add = screen.getByRole("button", { name: "Add Event after Lunch idea" });
    const row = add.closest(".slot-row") as HTMLElement;
    const axis = row.parentElement as HTMLElement;
    axis.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    // The axis starts at 08:00 with 64px per hour: 480px down is 15:30.
    fireEvent.click(row, { clientY: 480 });
    await user.click(add);
    expect(props.onCreateAt).toHaveBeenCalledTimes(1);
    expect(props.onCreateAt).toHaveBeenCalledWith(dayId, 930);
  });

  it("on a touch screen a tap outside dismisses the buttons", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: none)", media: query, addEventListener() {}, removeEventListener() {} }));
    setup();
    const add = screen.getByRole("button", { name: "Add Event between Station and Golden Pavilion" });
    await user.click(add);
    await user.click(document.body);
    expect(add.closest(".slot-row")?.classList.contains("open")).toBe(false);
  });

  it("Add Event before the first Event starts an hour before it", async () => {
    const user = userEvent.setup();
    const { props, dayId } = setup();
    await user.click(screen.getByRole("button", { name: "Add Event before Station" }));
    expect(props.onCreateAt).toHaveBeenCalledWith(dayId, 480);
  });

  it("Add Event after the last Event starts where it ends", async () => {
    const user = userEvent.setup();
    const { props, dayId } = setup();
    await user.click(screen.getByRole("button", { name: "Add Event after Lunch idea" }));
    expect(props.onCreateAt).toHaveBeenCalledWith(dayId, 840);
  });

  it("Esc dismisses the buttons shown by a tap", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: none)", media: query, addEventListener() {}, removeEventListener() {} }));
    setup();
    const add = screen.getByRole("button", { name: "Add Event between Station and Golden Pavilion" });
    await user.click(add);
    await user.keyboard("{Escape}");
    expect(add.closest(".slot-row")?.classList.contains("open")).toBe(false);
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
    const pill = screen.getByRole("button", { name: "Transit, 25 min. Open the Leg" });
    expect(pill.textContent).toContain("25 min");
    // The Leg takes the place of the slot.
    expect(screen.queryByRole("button", { name: /Add travel between/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Event between Station and Golden Pavilion" })).toBeNull();
    await user.click(pill);
    const dialog = screen.getByRole("dialog", { name: "Leg · 25 min" });
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
    await user.click(screen.getByRole("button", { name: /Open the Leg/ }));
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
    const pill = screen.getByRole("button", { name: /Open the Leg/ });
    expect(pill.textContent).toContain("1 h 30 min · gap 1 h");
    await user.click(pill);
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toContain("Gap is shorter than the trip");
  });

  it("shows 'Can't calculate' with no map link when the Leg has no duration", async () => {
    const user = userEvent.setup();
    cleanup();
    withLeg({ durationMinutes: null, distanceMeters: null });
    const pill = screen.getByRole("button", { name: /Open the Leg/ });
    expect(pill.textContent).toContain("Can't calculate");
    await user.click(pill);
    const dialog = screen.getByRole("dialog", { name: "Leg · can't calculate" });
    expect(within(dialog).queryByRole("link")).toBeNull();
    expect(within(dialog).getByText("—")).toBeTruthy();
  });

  it("changes the mode at once and deletes without asking", async () => {
    const user = userEvent.setup();
    cleanup();
    const props = withLeg();
    await user.click(screen.getByRole("button", { name: /Open the Leg/ }));
    await user.click(screen.getByRole("button", { name: "Drive" }));
    expect(props.onChangeLegMode).toHaveBeenCalledWith(props.trip.legs[0], "drive");
    await user.click(screen.getByRole("button", { name: "Delete Leg" }));
    expect(props.onDeleteLeg).toHaveBeenCalledWith(props.trip.legs[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on a click elsewhere, and Esc closes it without clearing the selection", async () => {
    const user = userEvent.setup();
    cleanup();
    withLeg();
    await user.click(screen.getByRole("button", { name: /Open the Leg/ }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Open the Leg/ }));
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
    await user.click(screen.getByRole("button", { name: /Open the Leg/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Another Event lands between the two; the server's answer drops the Leg.
    const day = props.trip.days[0]!;
    const between = makeEvent({ title: "Between", startMinute: 600, durationMinutes: 30, dayId: day.id });
    props.rerenderWith({ ...props.trip, days: [{ ...day, events: [...day.events, between] }], legs: [] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
