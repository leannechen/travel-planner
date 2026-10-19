// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Event } from "@travel-planner/shared";
import { createRef, type MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventPanel, type PanelApi } from "./EventPanel";
import { UnsavedDialog } from "./UnsavedDialog";
import { makeDay, makeEvent, renderApp, setPhone } from "./test-helpers";

const kinkaku = { id: "p1", name: "Kinkaku-ji", address: "Kita Ward, Kyoto", lat: 35, lng: 135 };
vi.mock("./api", () => ({ searchPlaces: vi.fn(async () => [kinkaku]), getPlaces: vi.fn(async () => []) }));
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ label }: { label: string }) => <textarea aria-label={label} />,
}));

const days = [makeDay(1), makeDay(2)];

function setup(event: Event | undefined | null = makeEvent({ dayId: days[0]!.id, holding: null })) {
  event ??= undefined;
  const apiRef = createRef<PanelApi | undefined>() as MutableRefObject<PanelApi | undefined>;
  const props = {
    days,
    event,
    newEvent: event ? undefined : { dayId: days[0]!.id, startMinute: 600, durationMinutes: 60 },
    onCreate: vi.fn(async (input: Record<string, unknown>) => ({ ...makeEvent(), ...input }) as Event),
    onUpdate: vi.fn(async (_id: string, input: Record<string, unknown>) => ({ ...event, ...input }) as Event),
    onDraftChange: vi.fn(),
    onClose: vi.fn(),
    apiRef,
    todos: [],
    onAddTodo: vi.fn(),
    onToggleTodo: vi.fn(),
    onDeleteTodo: vi.fn(),
    onDelete: vi.fn(),
  };
  renderApp(<EventPanel {...props} />);
  return props;
}

beforeEach(() => {
  setPhone(false);
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(cleanup);

describe("Event panel saves on Save", () => {
  it("does not save when a field loses focus", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole("textbox", { name: "Title" }), " II");
    await user.click(screen.getByRole("textbox", { name: "Description" }));
    await user.tab();
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  async function chooseLocation(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByRole("combobox", { name: "Location" }), "kin");
    await user.click(await screen.findByRole("option", { name: /Kinkaku-ji/ }));
  }

  it("a chosen location is unsaved until Save", async () => {
    const user = userEvent.setup();
    const props = setup();
    await chooseLocation(user);
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.apiRef.current!.isDirty()).toBe(true);
  });

  it("a location chosen for a new Event without a title is unsaved, and saving it asks for a title", async () => {
    const user = userEvent.setup();
    const props = setup(null);
    await chooseLocation(user);
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(props.apiRef.current!.isDirty()).toBe(true);
    // What the dialog's Save does: it must fail, not close the panel and lose the location.
    expect(await props.apiRef.current!.save()).toBe(false);
    expect((await screen.findByRole("alert")).textContent).toBe("Enter a title to save this Event");
  });

  it("a chosen Transport type waits for Save", async () => {
    const user = userEvent.setup();
    const props = setup(makeEvent({ dayId: days[0]!.id, holding: null, kind: "transport" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Transport type" }), "flight");
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.apiRef.current!.isDirty()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(props.event!.id, expect.objectContaining({ transportLabel: "flight" })));
  });

  it("Save sends the changes and closes", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole("textbox", { name: "Title" }), " II");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledWith());
    expect(props.onUpdate).toHaveBeenCalledWith(props.event!.id, expect.objectContaining({ title: `${props.event!.title} II` }));
  });

  it("Enter in a field saves and closes", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "!{Enter}");
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(props.onUpdate).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes without saving and without asking", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "!");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledWith(true);
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("stays open with the error when the typed values are not valid", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Title is required");
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("closing with X or Esc asks the page to close, and saves nothing itself", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "!");
    await user.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Title" }), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("choosing a Kind waits for Save", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("radio", { name: /Meal/ }));
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.apiRef.current!.isDirty()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(props.event!.id, expect.objectContaining({ kind: "meal" })));
  });

  it("reports unsaved changes to the page, and saves on request", async () => {
    const user = userEvent.setup();
    const props = setup();
    expect(props.apiRef.current!.isDirty()).toBe(false);
    await user.type(screen.getByRole("textbox", { name: "Title" }), "!");
    expect(props.apiRef.current!.isDirty()).toBe(true);
    expect(await props.apiRef.current!.save()).toBe(true);
    expect(props.onUpdate).toHaveBeenCalledTimes(1);
    expect(props.apiRef.current!.isDirty()).toBe(false);
  });

  it("a new Event with a title is created by Save", async () => {
    const user = userEvent.setup();
    const props = setup(null);
    expect(props.apiRef.current!.isDirty()).toBe(false);
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Lunch");
    expect(props.apiRef.current!.isDirty()).toBe(true);
    expect(props.onCreate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe("Save on a new Event without a title", () => {
  it("stays open and says a title is needed, once something was typed", async () => {
    const user = userEvent.setup();
    const props = setup(null);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const again = setup(null);
    await user.type(screen.getByRole("spinbutton", { name: /Duration/ }), "5");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Enter a title to save this Event");
    expect(again.onClose).not.toHaveBeenCalled();
    expect(again.onCreate).not.toHaveBeenCalled();
  });
});

describe("UnsavedDialog", () => {
  it("offers Keep editing, Discard and Save, and Esc keeps editing", async () => {
    const user = userEvent.setup();
    const handlers = { onSave: vi.fn(), onDiscard: vi.fn(), onKeep: vi.fn() };
    renderApp(<UnsavedDialog {...handlers} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    expect(handlers.onDiscard).toHaveBeenCalledTimes(1);
    expect(handlers.onKeep).toHaveBeenCalledTimes(1);
    fireEvent(screen.getByRole("dialog", { hidden: true }), new Event("cancel", { cancelable: true }));
    expect(handlers.onKeep).toHaveBeenCalledTimes(2);
  });
});
