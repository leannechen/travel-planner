// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { daily, type Event } from "@travel-planner/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOpeningHours } from "./api";
import { EventPanel } from "./EventPanel";
import { makeDay, makeEvent, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", () => ({ searchPlaces: vi.fn(async () => []), getPlaces: vi.fn(async () => []), getOpeningHours: vi.fn() }));
vi.mock("./MarkdownEditor", () => ({ MarkdownEditor: () => <textarea /> }));

const days = [makeDay(1), makeDay(2)];

function setup(event: Event, startDate: string | null = "2026-11-03") {
  const props = {
    days,
    event,
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDraftChange: vi.fn(),
    onClose: vi.fn(),
    todos: [],
    onAddTodo: vi.fn(),
    onToggleTodo: vi.fn(),
    onDeleteTodo: vi.fn(),
    onDelete: vi.fn(),
    startDate: startDate ?? undefined,
    onOpenTripSettings: vi.fn(),
    onTurnOnOpeningHours: vi.fn(async () => "on" as const),
    onRemoveOpeningHours: vi.fn(async () => undefined),
  };
  renderApp(<EventPanel {...props} />);
  return props;
}

const visit = (overrides: Partial<Event> = {}) => makeEvent({ dayId: days[0]!.id, holding: null, placeId: "fake:kinkaku-ji", startMinute: 600, durationMinutes: 60, ...overrides });

beforeEach(() => {
  setPhone(false);
  vi.mocked(getOpeningHours).mockResolvedValue(new Map([["fake:kinkaku-ji", daily(540, 1020)]]));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Event panel opening hours", () => {
  it("offers the button for an Attraction with a place, and asks for them when it is pressed", async () => {
    const props = setup(visit());
    await userEvent.click(screen.getByRole("button", { name: "Get opening hours from Google" }));
    expect(props.onTurnOnOpeningHours).toHaveBeenCalledWith(expect.any(String));
    expect(getOpeningHours).not.toHaveBeenCalled();
  });

  it("shows the hours of an Event that has them on, and no conflict when the time fits", async () => {
    setup(visit({ openingHoursOn: true }));
    expect(await screen.findByText("Daily 09:00 – 17:00")).toBeTruthy();
    expect(screen.queryByText("Opening hours may conflict")).toBeNull();
  });

  it("shows the conflict when the time does not fit", async () => {
    setup(visit({ openingHoursOn: true, startMinute: 18 * 60 }));
    expect(await screen.findByText("Opening hours may conflict")).toBeTruthy();
  });

  it("shows no conflict in a Trip without a start date, but a note", async () => {
    setup(visit({ openingHoursOn: true, startMinute: 18 * 60 }), null);
    expect(await screen.findByText(/Add a start date/)).toBeTruthy();
    expect(screen.queryByText("Opening hours may conflict")).toBeNull();
  });

  it("removes them", async () => {
    const props = setup(visit({ openingHoursOn: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove opening hours" }));
    expect(props.onRemoveOpeningHours).toHaveBeenCalledOnce();
  });

  it("is not shown for an Event without a place, a Lodging or a Transport event", () => {
    for (const event of [visit({ placeId: null }), visit({ kind: "lodging", nights: 1 }), visit({ kind: "transport" })]) {
      setup(event);
      expect(screen.queryByText("Opening hours")).toBeNull();
      cleanup();
    }
  });

  it("is shown for a Meal", () => {
    setup(visit({ kind: "meal" }));
    expect(screen.getByRole("button", { name: "Get opening hours from Google" })).toBeTruthy();
  });

  it("is hidden while the Location has an unsaved change, since the hours belong to the saved place", async () => {
    setup(visit());
    await userEvent.click(screen.getByRole("button", { name: "Remove Location" }));
    expect(screen.queryByText("Opening hours")).toBeNull();
  });
});
