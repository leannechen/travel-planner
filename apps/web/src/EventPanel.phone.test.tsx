// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Event } from "@travel-planner/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventPanel } from "./EventPanel";
import { makeDay, makeEvent, renderApp, setPhone } from "./test-helpers";

// The Markdown editor needs a real browser; a plain field stands in for it.
vi.mock("./api", () => ({ searchPlaces: vi.fn(async () => [{ id: "p1", name: "Kinkaku-ji", address: "Kyoto", lat: 1, lng: 1 }]), getPlaces: vi.fn(async () => []) }));

vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ label }: { label: string }) => <textarea aria-label={label} />,
}));

const days = [makeDay(1), makeDay(2)];

function setup(overrides: { event?: Event; onUpdate?: (id: string, input: Record<string, unknown>) => Promise<Event> } = {}) {
  const event = overrides.event ?? makeEvent({ dayId: days[0]!.id, holding: null });
  const props = {
    days,
    event,
    onCreate: vi.fn(),
    onUpdate: vi.fn(overrides.onUpdate ?? (async (_id: string, input: Record<string, unknown>) =>
        // Like the server: a move to an area clears the Day and sets the area.
        ({ ...event, ...input, ...(input.area ? { holding: input.area, dayId: null } : {}) }) as Event)),
    onDraftChange: vi.fn(),
    onClose: vi.fn(),
    todos: [],
    onAddTodo: vi.fn(),
    onToggleTodo: vi.fn(),
    onDeleteTodo: vi.fn(),
    onDelete: vi.fn(),
    onOpenTripSettings: vi.fn(),
    onTurnOnOpeningHours: vi.fn(),
    onRemoveOpeningHours: vi.fn(),
  };
  renderApp(<EventPanel {...props} />);
  return props;
}

beforeEach(() => setPhone(true));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EventPanel on a phone", () => {
  it("has a handle instead of a close button, a Day and Kind dropdown and a footer", () => {
    setup();
    expect(screen.getByRole("combobox", { name: "Day" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Kind" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Archive/ })).toBeTruthy();
  });

  it("Save saves what was typed, then closes", async () => {
    const user = userEvent.setup();
    const props = setup();
    const title = screen.getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Kinkaku-ji");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ title: "Kinkaku-ji" }));
  });

  it("stays open and shows the error in the footer when the save fails", async () => {
    const user = userEvent.setup();
    const props = setup({ onUpdate: async () => Promise.reject(new Error("Server is down")) });
    await user.type(screen.getByRole("textbox", { name: "Title" }), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.querySelector(".sheet-footer .sheet-error")?.textContent).toBe("Server is down"));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("Archive moves the Event to the Archive and closes", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /^Archive$/ }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ area: "archive" }));
  });

  it("stays open when the move to the Archive is declined", async () => {
    const user = userEvent.setup();
    // The page answers with the Event unchanged when the user cancels its confirmation.
    const event = makeEvent({ dayId: days[0]!.id, holding: null });
    const props = setup({ event, onUpdate: async () => event });
    await user.click(screen.getByRole("button", { name: /^Archive$/ }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalled());
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("a chosen Day waits for Save", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Day" }), days[1]!.id);
    expect(props.onUpdate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ dayId: days[1]!.id })));
  });

  it("stays open when Save moves it to the Archive and that is declined", async () => {
    const user = userEvent.setup();
    const event = makeEvent({ dayId: days[0]!.id, holding: null });
    const props = setup({ event, onUpdate: async () => event });
    await user.selectOptions(screen.getByRole("combobox", { name: "Day" }), "archive");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalled());
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("Archive saves what was typed together with the move", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "!");
    await user.click(screen.getByRole("button", { name: /^Archive$/ }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ area: "archive", title: `${props.event.title}!` })));
  });

  it("switches the split button to Delete from its menu, then deletes", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("button", { name: /Delete.*Remove this Event for good/ }));
    expect(screen.queryByText("Remove this Event for good")).toBeNull();
    const main = screen.getByRole("button", { name: /^Delete$/ });
    expect(screen.queryByRole("button", { name: /^Archive$/ })).toBeNull();
    // Both choices keep the same width class, so Save does not change size.
    expect(main.className).toContain("split-main");
    await user.click(main);
    expect(props.onDelete).toHaveBeenCalledWith(props.event);
  });

  it("closes the menu on a tap outside it, and the first tap on the scrim only closes the menu", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByText("Remove this Event for good")).toBeTruthy();
    await user.click(document.querySelector(".sheet-scrim")!);
    expect(screen.queryByText("Remove this Event for good")).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    await user.click(document.querySelector(".sheet-scrim")!);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("closes the menu when the panel body is tapped", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.pointerDown(document.querySelector(".panel-body")!);
    await waitFor(() => expect(screen.queryByText("Remove this Event for good")).toBeNull());
  });

  it("offers only Delete for an Event already in the Archive", () => {
    setup({ event: makeEvent({ holding: "archive" }) });
    expect(screen.getByRole("button", { name: /^Delete$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("shows only Save for a new Event", () => {
    renderApp(
      <EventPanel
        days={days}
        newEvent={{ dayId: days[0]!.id, startMinute: 600, durationMinutes: 60 }}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDraftChange={vi.fn()}
        onClose={vi.fn()}
        todos={[]}
        onAddTodo={vi.fn()}
        onToggleTodo={vi.fn()}
        onDeleteTodo={vi.fn()}
        onDelete={vi.fn()}
        onOpenTripSettings={vi.fn()}
        onTurnOnOpeningHours={vi.fn()}
        onRemoveOpeningHours={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Archive/ })).toBeNull();
  });

  it("saves a place chosen in the Location field on Save, and Transport has From and To", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole("combobox", { name: "Location" }), "kin");
    await user.click(await screen.findByRole("option", { name: /Kinkaku-ji/ }));
    expect(props.onUpdate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ placeId: "p1" })));
    await user.selectOptions(screen.getByRole("combobox", { name: "Kind" }), "transport");
    expect(screen.getByText(/From/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /To/ })).toBeTruthy();
  });

  it("changes the Kind from the dropdown on Save", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Kind" }), "meal");
    expect(props.onUpdate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ kind: "meal" })));
  });
});

describe("EventPanel on a desktop", () => {
  it("has no Day list, since Events are dragged between Days", () => {
    setPhone(false);
    setup();
    expect(screen.queryByRole("combobox", { name: "Day" })).toBeNull();
  });

  it("keeps the close button and has no footer or scrim", () => {
    setPhone(false);
    setup();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(document.querySelector(".sheet-footer")).toBeNull();
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete Event" })).toBeTruthy();
  });
});
