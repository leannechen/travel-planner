// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Place } from "@travel-planner/shared";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getPlaces, searchPlaces } from "./api";
import { PlaceField } from "./PlaceField";
import { renderApp } from "./test-helpers";

vi.mock("./api", async (importOriginal) => ({ ApiError: (await importOriginal<typeof import("./api")>()).ApiError, searchPlaces: vi.fn(), getPlaces: vi.fn() }));

const kinkaku: Place = { id: "p1", name: "Kinkaku-ji", address: "Kita Ward, Kyoto", area: "Kita Ward, Kyoto", lat: 35, lng: 135 };
const nara: Place = { id: "p2", name: "Nara Park", address: "Nara", area: "Nara", lat: 34, lng: 135 };

// Holds the chosen id like the Event panel does.
function Harness({ initial = "", onChange }: { initial?: string; onChange: (id: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <PlaceField
      label="Location"
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
    />
  );
}

beforeEach(() => {
  vi.mocked(searchPlaces).mockResolvedValue([kinkaku, nara]);
  vi.mocked(getPlaces).mockResolvedValue([kinkaku]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlaceField", () => {
  it("searches while typing and passes on the id of the chosen result", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderApp(<Harness onChange={onChange} />);
    await user.type(screen.getByRole("combobox", { name: "Location" }), "kin");
    await user.click(await screen.findByRole("option", { name: /Kinkaku-ji/ }));
    expect(onChange).toHaveBeenCalledWith("p1");
    expect(vi.mocked(searchPlaces)).toHaveBeenLastCalledWith("kin");
    // The chosen place is shown with its name and address.
    expect(screen.getByText("Kinkaku-ji")).toBeTruthy();
    expect(screen.getByText("Kita Ward, Kyoto")).toBeTruthy();
  });

  it("waits for a pause in typing before searching", async () => {
    const user = userEvent.setup();
    renderApp(<Harness onChange={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "kinkaku");
    await screen.findByRole("option", { name: /Kinkaku-ji/ });
    expect(vi.mocked(searchPlaces)).toHaveBeenCalledTimes(1);
  });

  it("picks with the arrow keys and Enter, without submitting a form", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    renderApp(
      <form onSubmit={onSubmit}>
        <Harness onChange={onChange} />
      </form>,
    );
    await user.type(screen.getByRole("combobox"), "k");
    await screen.findByRole("option", { name: /Nara Park/ });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("p2");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closes the results on Escape without letting the panel see it", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    renderApp(
      <div onKeyDown={onKeyDown}>
        <Harness onChange={vi.fn()} />
      </div>,
    );
    await user.type(screen.getByRole("combobox"), "k");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onKeyDown).not.toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
  });

  it("says when nothing matches and when places are unavailable", async () => {
    const user = userEvent.setup();
    vi.mocked(searchPlaces).mockResolvedValueOnce([]);
    renderApp(<Harness onChange={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "zzz");
    expect(await screen.findByText("No places found")).toBeTruthy();
    vi.mocked(searchPlaces).mockRejectedValueOnce(new Error("down"));
    await user.type(screen.getByRole("combobox"), "z");
    expect((await screen.findByRole("alert")).textContent).toBe("Places are not available right now");
  });

  it("says when searches are limited for a minute or for today", async () => {
    const user = userEvent.setup();
    vi.mocked(searchPlaces).mockRejectedValueOnce(new ApiError("Too many place searches", "search_limit", { window: "minute" }));
    renderApp(<Harness onChange={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "kyoto");
    expect((await screen.findByRole("alert")).textContent).toBe("Too many searches. Try again in a minute.");
    vi.mocked(searchPlaces).mockRejectedValueOnce(new ApiError("Used up", "search_limit", { window: "day" }));
    await user.type(screen.getByRole("combobox"), "s");
    expect(await screen.findByText("Today's place searches are used up. Try again tomorrow.")).toBeTruthy();
  });

  it("shows a place chosen earlier by looking it up by id, and removes it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderApp(<Harness initial="p1" onChange={onChange} />);
    expect(await screen.findByText("Kinkaku-ji")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove Location" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(await screen.findByRole("combobox")).toBeTruthy();
  });

  it("moves focus to the Remove button after a place is chosen, and back to the search when removed", async () => {
    const user = userEvent.setup();
    renderApp(<Harness onChange={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "k");
    await screen.findByRole("option", { name: /Kinkaku-ji/ });
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove Location" })));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox")));
  });

  it("lets Escape reach the panel when no results are showing", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    renderApp(
      <div onKeyDown={onKeyDown}>
        <Harness onChange={vi.fn()} />
      </div>,
    );
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("{Escape}");
    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
  });

  it("drops the earlier results when a search fails", async () => {
    const user = userEvent.setup();
    renderApp(<Harness onChange={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "k");
    await screen.findByRole("option", { name: /Kinkaku-ji/ });
    vi.mocked(searchPlaces).mockRejectedValueOnce(new Error("down"));
    await user.type(screen.getByRole("combobox"), "a");
    await screen.findByRole("alert");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("keeps the status messages out of the listbox", async () => {
    const user = userEvent.setup();
    vi.mocked(searchPlaces).mockResolvedValueOnce([]);
    renderApp(<Harness onChange={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "zzz");
    const note = await screen.findByText("No places found");
    expect(screen.getByRole("listbox").contains(note)).toBe(false);
  });

  it("says so when a chosen place is no longer known, or its lookup fails", async () => {
    vi.mocked(getPlaces).mockResolvedValueOnce([]);
    renderApp(<Harness initial="gone-1" onChange={vi.fn()} />);
    expect(await screen.findByText("This place is no longer available")).toBeTruthy();
    cleanup();
    vi.mocked(getPlaces).mockRejectedValueOnce(new Error("down"));
    renderApp(<Harness initial="broken-1" onChange={vi.fn()} />);
    expect(await screen.findByText("This place is no longer available")).toBeTruthy();
    expect(screen.queryByText("…")).toBeNull();
  });

  it("ignores a slow answer that arrives after a newer search", async () => {
    const user = userEvent.setup();
    let slow!: (places: Place[]) => void;
    vi.mocked(searchPlaces).mockImplementationOnce(() => new Promise((resolve) => (slow = resolve)));
    vi.mocked(searchPlaces).mockResolvedValueOnce([nara]);
    renderApp(<Harness onChange={vi.fn()} />);
    const box = screen.getByRole("combobox");
    await user.type(box, "a");
    await waitFor(() => expect(searchPlaces).toHaveBeenCalledTimes(1));
    await user.type(box, "b");
    await screen.findByRole("option", { name: /Nara Park/ });
    slow([kinkaku]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("option", { name: /Kinkaku-ji/ })).toBeNull();
    fireEvent.blur(box);
  });
});
