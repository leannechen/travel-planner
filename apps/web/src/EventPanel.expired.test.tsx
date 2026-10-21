// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Event, EventFields } from "@travel-planner/shared";
import { createRef, type MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventPanel, type PanelApi } from "./EventPanel";
import { makeDay, makeEvent, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", () => ({ searchPlaces: vi.fn(async () => []), getPlaces: vi.fn(async () => []) }));
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ label }: { label: string }) => <textarea aria-label={label} />,
}));

const days = [makeDay(1), makeDay(2)];

// The panel with an Event, as when the session ended while the user was typing in it.
function setup(extra: { onLoginToSave?: (fields: EventFields) => Promise<boolean>; restored?: EventFields } = {}) {
  const event = makeEvent({ dayId: days[0]!.id, holding: null, title: "Fushimi Inari" });
  const apiRef = createRef<PanelApi | undefined>() as MutableRefObject<PanelApi | undefined>;
  const props = {
    days,
    event,
    onCreate: vi.fn(),
    onUpdate: vi.fn(async (_id: string, input: Record<string, unknown>) => ({ ...event, ...input }) as Event),
    onDraftChange: vi.fn(),
    onClose: vi.fn(),
    apiRef,
    todos: [],
    onAddTodo: vi.fn(),
    onToggleTodo: vi.fn(),
    onDeleteTodo: vi.fn(),
    onDelete: vi.fn(),
    onOpenTripSettings: vi.fn(),
    onTurnOnOpeningHours: vi.fn(),
    onRemoveOpeningHours: vi.fn(),
    ...extra,
  };
  renderApp(<EventPanel {...props} />);
  return props;
}

beforeEach(() => setPhone(false));
afterEach(cleanup);

describe("Event panel when the session has ended", () => {
  it("keeps what was typed, and Save becomes Log in to save", async () => {
    const user = userEvent.setup();
    const onLoginToSave = vi.fn(async () => false);
    const props = setup({ onLoginToSave });
    await user.type(screen.getByRole("textbox", { name: "Title" }), " upper trail");

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("Your changes are kept on this screen. Log in to save them.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Log in to save" }));
    // Not logged in (popup closed): nothing was saved, nothing was lost, the panel is still open.
    expect(onLoginToSave).toHaveBeenCalledOnce();
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Fushimi Inari upper trail");
    expect(props.apiRef.current!.isDirty()).toBe(true);
  });

  it("hands over the typed fields to log in with, so they can be kept across a redirect", async () => {
    const user = userEvent.setup();
    const onLoginToSave = vi.fn(async () => false);
    setup({ onLoginToSave });
    await user.type(screen.getByRole("textbox", { name: "Title" }), "!");
    await user.click(screen.getByRole("button", { name: "Log in to save" }));
    expect(onLoginToSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Fushimi Inari!" }));
  });

  it("saves the edits and closes once the login worked, as Save does", async () => {
    const user = userEvent.setup();
    const props = setup({ onLoginToSave: async () => true });
    await user.type(screen.getByRole("textbox", { name: "Title" }), " upper trail");
    await user.click(screen.getByRole("button", { name: "Log in to save" }));

    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(props.onUpdate).toHaveBeenCalledWith(props.event.id, expect.objectContaining({ title: "Fushimi Inari upper trail" }));
  });

  it("Enter in a field logs in instead of saving", async () => {
    const user = userEvent.setup();
    const onLoginToSave = vi.fn(async () => false);
    const props = setup({ onLoginToSave });
    await user.type(screen.getByRole("textbox", { name: "Title" }), "!{Enter}");
    expect(onLoginToSave).toHaveBeenCalledOnce();
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("starts with edits kept across a login redirect, and counts them as unsaved", () => {
    const base = setup().apiRef.current!.fields();
    cleanup();
    const props = setup({ restored: { ...base, title: "Fushimi Inari, restored" } });
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Fushimi Inari, restored");
    expect(props.apiRef.current!.isDirty()).toBe(true);
    // Back to a normal session: Save is Save.
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});
