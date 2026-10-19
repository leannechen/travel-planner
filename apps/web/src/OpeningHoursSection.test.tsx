// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { daily, type OpeningHours } from "@travel-planner/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpeningHoursSection } from "./OpeningHoursSection";
import { renderApp } from "./test-helpers";

afterEach(cleanup);

const h = (hours: number) => hours * 60;
const always: OpeningHours = { status: "open", periods: [{ start: 0, end: 7 * 1440 }] };
// Closed on Monday, 11:00 to 15:00 and 17:00 to 22:00 on Thursday, 11:00 to 22:00 the other days.
const varying: OpeningHours = {
  status: "open",
  periods: [0, 2, 3, 4, 5, 6].map((d) => ({ start: d * 1440 + h(11), end: d * 1440 + h(d === 4 ? 15 : 22) })).concat([{ start: 4 * 1440 + h(17), end: 4 * 1440 + h(22) }]),
};

function setup(props: Partial<Parameters<typeof OpeningHoursSection>[0]> = {}) {
  const all = {
    on: true,
    hours: varying as OpeningHours | undefined,
    fetching: false,
    weekday: 4 as number | undefined,
    dated: true,
    conflict: false,
    onSetDate: vi.fn(),
    onTurnOn: vi.fn(async () => "on" as const),
    onRemove: vi.fn(async () => undefined),
    ...props,
  };
  renderApp(<OpeningHoursSection {...all} />);
  return all;
}

describe("Opening hours section", () => {
  it("offers the button while off, and turns on when it is pressed", async () => {
    const props = setup({ on: false, hours: undefined });
    await userEvent.click(screen.getByRole("button", { name: "Get opening hours from Google" }));
    expect(props.onTurnOn).toHaveBeenCalledOnce();
  });

  it("shows progress while the hours are being fetched", async () => {
    let finish: (v: "on") => void = () => undefined;
    setup({ on: false, hours: undefined, onTurnOn: () => new Promise((resolve) => (finish = resolve)) });
    await userEvent.click(screen.getByRole("button", { name: "Get opening hours from Google" }));
    expect((screen.getByRole("button", { name: "Getting opening hours…" }) as HTMLButtonElement).disabled).toBe(true);
    finish("on");
    await waitFor(() => expect((screen.getByRole("button", { name: "Get opening hours from Google" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows progress for an Event that has them on while the first answer is awaited", () => {
    setup({ hours: undefined, fetching: true });
    expect((screen.getByRole("button", { name: "Getting opening hours…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says so when Google has none, and keeps the button", async () => {
    setup({ on: false, hours: undefined, onTurnOn: async () => "none" });
    await userEvent.click(screen.getByRole("button", { name: "Get opening hours from Google" }));
    expect(await screen.findByText("Google has no opening hours for this place.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Get opening hours from Google" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says so when the request fails", async () => {
    setup({ on: false, hours: undefined, onTurnOn: () => Promise.reject(new Error("502")) });
    await userEvent.click(screen.getByRole("button", { name: "Get opening hours from Google" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Opening hours are not available right now.");
  });

  it("shows one line for a place open all the time, and no week", () => {
    setup({ hours: always });
    expect(screen.getByText("Open 24 hours")).toBeTruthy();
    expect(screen.getByText("from Google")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Whole week/ })).toBeNull();
  });

  it("shows one line for the same hours every day", () => {
    setup({ hours: daily(h(9), h(17)) });
    expect(screen.getByText("Daily 09:00 – 17:00")).toBeTruthy();
  });

  it("shows the Event's weekday with the whole week one click away", async () => {
    setup();
    expect(screen.getByText("Thu 11:00 – 15:00, 17:00 – 22:00")).toBeTruthy();
    expect(screen.queryByText("Closed")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Whole week/ }));
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getAllByText("11:00 – 22:00")).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: /Whole week/ }));
    expect(screen.queryByText("Closed")).toBeNull();
  });

  it("lists the week straight away, with a note, when the Trip has no start date", () => {
    setup({ weekday: undefined, dated: false });
    expect(screen.getByText("Whole week")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText(/to this Trip to check these hours against your plan\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Whole week/ })).toBeNull();
  });

  it("links the note to Trip settings", async () => {
    const props = setup({ weekday: undefined, dated: false });
    await userEvent.click(screen.getByRole("button", { name: "Add a start date" }));
    expect(props.onSetDate).toHaveBeenCalledOnce();
  });

  it("lists the week without the note for an Event outside a Day of a dated Trip", () => {
    setup({ weekday: undefined, dated: true });
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.queryByText(/Add a start date/)).toBeNull();
  });

  it("shows the conflict beside the hours only when there is one", () => {
    setup({ conflict: true });
    expect(screen.getByRole("status").textContent).toContain("Opening hours may conflict");
    cleanup();
    setup({ conflict: false });
    expect(screen.queryByText("Opening hours may conflict")).toBeNull();
  });

  it("tells about a place Google reports as closed", () => {
    setup({ hours: { status: "closed-permanently", periods: [] }, conflict: true });
    expect(screen.getByText("Permanently closed")).toBeTruthy();
  });

  it("removes the opening hours", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Remove opening hours" }));
    expect(props.onRemove).toHaveBeenCalledOnce();
  });
});
