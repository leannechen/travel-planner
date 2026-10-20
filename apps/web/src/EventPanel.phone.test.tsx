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

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "More actions" }));
}

async function chooseKind(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: /^Kind:/ }));
  await user.click(screen.getByRole("option", { name: new RegExp(name) }));
}

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
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("EventPanel on a phone", () => {
  it("has a handle instead of a close button, a Day and Kind dropdown and a footer", () => {
    setup();
    expect(screen.getByRole("combobox", { name: "Day" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Kind:/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    // Save is not hidden by a style rule (the stylesheet is not loaded in tests, so check the class).
    expect(screen.getByRole("button", { name: "Save" }).className).not.toContain("grow");
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

  it("stays open and shows the error when the save fails", async () => {
    const user = userEvent.setup();
    const props = setup({ onUpdate: async () => Promise.reject(new Error("Server is down")) });
    await user.type(screen.getByRole("textbox", { name: "Title" }), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.querySelector(".panel-error")?.textContent).toBe("Server is down"));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("Archive moves the Event to the Archive and closes", async () => {
    const user = userEvent.setup();
    const props = setup();
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /^Archive/ }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ area: "archive" }));
  });

  it("stays open when the move to the Archive is declined", async () => {
    const user = userEvent.setup();
    // The page answers with the Event unchanged when the user cancels its confirmation.
    const event = makeEvent({ dayId: days[0]!.id, holding: null });
    const props = setup({ event, onUpdate: async () => event });
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /^Archive/ }));
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
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /^Archive/ }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ area: "archive", title: `${props.event.title}!` })));
  });

  it("Move to Backlog saves what was typed, moves the Event and closes", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "!");
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /^Move to Backlog/ }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ area: "backlog", title: `${props.event.title}!` }));
  });

  it("stays open when Move to Backlog is declined", async () => {
    const user = userEvent.setup();
    const event = makeEvent({ dayId: days[0]!.id, holding: null });
    const props = setup({ event, onUpdate: async () => event });
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /^Move to Backlog/ }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalled());
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("Delete from the menu asks the page to delete", async () => {
    const user = userEvent.setup();
    const props = setup();
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /^Delete/ }));
    expect(props.onDelete).toHaveBeenCalledWith(props.event);
  });

  it("closes the menu on a tap outside it, and the first tap on the scrim only closes the menu", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByText("Can be undone for a few seconds")).toBeTruthy();
    await user.click(document.querySelector(".sheet-scrim")!);
    expect(screen.queryByText("Can be undone for a few seconds")).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    await user.click(document.querySelector(".sheet-scrim")!);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("closes the menu when the panel body is tapped", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.pointerDown(document.querySelector(".panel-body")!);
    await waitFor(() => expect(screen.queryByText("Can be undone for a few seconds")).toBeNull());
  });

  it("offers Restore to Backlog and Delete for an Event in the Archive", async () => {
    const user = userEvent.setup();
    const props = setup({ event: makeEvent({ holding: "archive", dayId: null }) });
    await openMenu(user);
    expect(screen.queryByRole("menuitem", { name: /^Archive/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^Move to Backlog/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /^Delete/ })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "Restore to Backlog" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ area: "backlog" })));
  });

  it("offers Archive and Delete for a Backlog Event", async () => {
    const user = userEvent.setup();
    setup({ event: makeEvent({ holding: "backlog", dayId: null }) });
    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: /^Archive/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Move to Backlog/ })).toBeNull();
  });

  it("shows Add Event and no ⋯ menu for a new Event", () => {
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
    expect(screen.getByRole("button", { name: "Add Event" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("saves a place chosen in the Location field on Save, and Transport has From and To", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole("combobox", { name: "Location" }), "kin");
    await user.click(await screen.findByRole("option", { name: /Kinkaku-ji/ }));
    expect(props.onUpdate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ placeId: "p1" })));
    await chooseKind(user, "Transport");
    expect(screen.getByText(/From/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /To/ })).toBeTruthy();
  });

  it("changes the Kind from the dropdown on Save", async () => {
    const user = userEvent.setup();
    const props = setup();
    await chooseKind(user, "Meal");
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

  it("has a close button, a footer with ⋯, Close and Save, and no scrim", async () => {
    setPhone(false);
    const user = userEvent.setup();
    setup();
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    await openMenu(user);
    expect(screen.queryByText("Can be undone for a few seconds")).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("the footer's Close reads Cancel once something was typed", async () => {
    setPhone(false);
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "!");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("Expand makes it a dialog, Collapse brings back the side panel, and the choice is kept", async () => {
    setPhone(false);
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(localStorage.getItem("travel-planner.event-panel-expanded")).toBe("1");
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a click on the backdrop closes the panel, but only closes the ⋯ menu when it is open", async () => {
    setPhone(false);
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    await openMenu(user);
    await user.click(document.querySelector(".panel-backdrop")!);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    await user.click(document.querySelector(".panel-backdrop")!);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("has no Expand button on a phone", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
  });
});
