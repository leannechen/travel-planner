// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Place } from "@travel-planner/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlaces } from "./api";
import { MapView } from "./MapView";
import { makeDay, makeEvent, makeTrip, renderApp } from "./test-helpers";

vi.mock("./api", () => ({ getPlaces: vi.fn() }));

const place = (id: string, name: string, lat: number, lng: number): Place => ({ id, name, address: "", lat, lng });
const PLACES = [place("p-temple", "Temple", 35, 135), place("p-market", "Market", 35.01, 135.02), place("p-park", "Park", 34.9, 135.1)];

const temple = makeEvent({ title: "Visit temple", startMinute: 540, placeId: "p-temple" });
const market = makeEvent({ title: "Lunch at market", kind: "meal", startMinute: 720, placeId: "p-market" });
const idea = makeEvent({ title: "Idea without place", startMinute: 800 });
const park = makeEvent({ title: "Maybe the park", holding: "backlog", placeId: "p-park" });

function setup(selectedEventId?: string) {
  const day1 = makeDay(1, [temple, idea]);
  const day2 = makeDay(2, [market]);
  const trip = makeTrip({ days: [day1, day2], backlog: [park] });
  const onSelectEvent = vi.fn();
  renderApp(<MapView trip={trip} selectedEventId={selectedEventId} onSelectEvent={onSelectEvent} />);
  return { onSelectEvent };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(getPlaces).mockImplementation(async (ids) => PLACES.filter((p) => ids.includes(p.id)));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Map View", () => {
  it("shows a marker for every Event with a place, and none for one without", async () => {
    setup();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Visit temple/ })).toHaveLength(2));
    const map = screen.getByTestId("fake-map");
    expect(within(map).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByText("Idea without place")).toBeNull();
  });

  it("opens the Event when its marker or its list row is clicked", async () => {
    const { onSelectEvent } = setup();
    const marker = await within(screen.getByTestId("fake-map")).findByRole("button", { name: /Lunch at market/ });
    fireEvent.click(marker);
    expect(onSelectEvent).toHaveBeenLastCalledWith(market.id);
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /Visit temple/ }));
    expect(onSelectEvent).toHaveBeenLastCalledWith(temple.id);
  });

  it("shows one Day when its chip is chosen, still with the Backlog", async () => {
    setup();
    const map = screen.getByTestId("fake-map");
    await within(map).findByRole("button", { name: /Visit temple/ });
    fireEvent.click(screen.getByRole("button", { name: "Day 2" }));
    expect(within(map).queryByRole("button", { name: /Visit temple/ })).toBeNull();
    expect(within(map).getByRole("button", { name: /Lunch at market/ })).toBeTruthy();
    expect(within(map).getByRole("button", { name: /Maybe the park/ })).toBeTruthy();
  });

  it("can leave the Backlog out", async () => {
    setup();
    const map = screen.getByTestId("fake-map");
    await within(map).findByRole("button", { name: /Maybe the park/ });
    fireEvent.click(screen.getByRole("checkbox", { name: "Backlog" }));
    expect(within(map).queryByRole("button", { name: /Maybe the park/ })).toBeNull();
  });

  it("draws the Day's dashed line, and not when turned off", async () => {
    // Two Events with a place on one Day.
    const day = makeDay(1, [temple, makeEvent({ title: "Second", startMinute: 700, placeId: "p-market" })]);
    renderApp(<MapView trip={makeTrip({ days: [day] })} onSelectEvent={vi.fn()} />);
    const map = screen.getByTestId("fake-map");
    await within(map).findByRole("button", { name: /Second/ });
    expect(map.querySelectorAll("line")).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Day lines" }));
    expect(map.querySelectorAll("line")).toHaveLength(0);
  });

  it("says so when no Event has a place", () => {
    renderApp(<MapView trip={makeTrip({ days: [makeDay(1, [idea])] })} onSelectEvent={vi.fn()} />);
    expect(screen.getByText(/No Events with a location yet/)).toBeTruthy();
  });

  it("says some places are missing when the lookup fails", async () => {
    vi.mocked(getPlaces).mockRejectedValue(new Error("down"));
    renderApp(<MapView trip={makeTrip({ days: [makeDay(1, [makeEvent({ title: "Elsewhere", placeId: "p-unknown", holding: null })])] })} onSelectEvent={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("could not be loaded"));
  });
});
