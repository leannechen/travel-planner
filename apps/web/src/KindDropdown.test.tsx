// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KindDropdown } from "./KindDropdown";
import { renderApp } from "./test-helpers";

afterEach(cleanup);

function setup() {
  const onChange = vi.fn();
  const onOuterKey = vi.fn();
  renderApp(
    <div onKeyDown={onOuterKey}>
      <KindDropdown value="attraction" onChange={onChange} />
    </div>,
  );
  return { onChange, onOuterKey, trigger: screen.getByRole("button", { name: /^Kind:/ }) };
}

describe("KindDropdown", () => {
  it("moves with the arrow keys and picks with Enter", async () => {
    const user = userEvent.setup();
    const { onChange, trigger } = setup();
    trigger.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("lodging");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("jumps to a kind by its first letter", async () => {
    const user = userEvent.setup();
    const { onChange, trigger } = setup();
    trigger.focus();
    await user.keyboard("{ArrowDown}t{Enter}");
    expect(onChange).toHaveBeenCalledWith("transport");
  });

  it("closes the list with Esc without letting the panel see it", async () => {
    const user = userEvent.setup();
    const { onOuterKey, trigger } = setup();
    await user.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();
    onOuterKey.mockClear();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onOuterKey).not.toHaveBeenCalled();
  });

  it("closes when focus leaves it", async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    await user.tab();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
