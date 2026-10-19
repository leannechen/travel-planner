// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Place } from "@travel-planner/shared";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlaces, searchPlaces } from "./api";
import { PlaceField } from "./PlaceField";
import { renderApp } from "./test-helpers";

vi.mock("./api", () => ({ searchPlaces: vi.fn(), getPlaces: vi.fn() }));

const kinkaku: Place = { id: "p1", name: "Kinkaku-ji", address: "Kita Ward, Kyoto", lat: 35, lng: 135 };
const nara: Place = { id: "p2", name: "Nara Park", address: "Nara", lat: 34, lng: 135 };

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
    expect(await screen.findByRole("alert")).toBeTruthy();
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
