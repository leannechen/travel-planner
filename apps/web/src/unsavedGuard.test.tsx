// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PanelApi } from "./EventPanel";
import { useUnsavedGuard } from "./unsavedGuard";

function setup(panel?: Partial<PanelApi>) {
  const apply = vi.fn();
  const hook = renderHook(() => useUnsavedGuard<string>(apply));
  if (panel) hook.result.current.panelApi.current = { isDirty: () => false, save: async () => true, ...panel };
  return { apply, hook };
}

describe("useUnsavedGuard", () => {
  it("leaves at once when nothing is unsaved, or no panel is open", () => {
    const { apply, hook } = setup();
    act(() => hook.result.current.select("b"));
    expect(apply).toHaveBeenCalledWith("b");
    hook.result.current.panelApi.current = { isDirty: () => false, save: async () => true };
    act(() => hook.result.current.select("c"));
    expect(apply).toHaveBeenLastCalledWith("c");
    expect(hook.result.current.asking).toBe(false);
  });

  it("asks when the panel is dirty, and Keep editing stays", () => {
    const { apply, hook } = setup({ isDirty: () => true });
    act(() => hook.result.current.select("b"));
    expect(hook.result.current.asking).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    act(() => hook.result.current.keepEditing());
    expect(hook.result.current.asking).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("Discard leaves without saving", async () => {
    const save = vi.fn(async () => true);
    const { apply, hook } = setup({ isDirty: () => true, save });
    act(() => hook.result.current.select("b"));
    await act(() => hook.result.current.answer(false));
    expect(save).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledWith("b");
  });

  it("Save saves, then leaves", async () => {
    const save = vi.fn(async () => true);
    const { apply, hook } = setup({ isDirty: () => true, save });
    act(() => hook.result.current.select("b"));
    await act(() => hook.result.current.answer(true));
    expect(save).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("b");
    expect(hook.result.current.asking).toBe(false);
  });

  it("stays on the panel when the save fails", async () => {
    const { apply, hook } = setup({ isDirty: () => true, save: async () => false });
    act(() => hook.result.current.select("b"));
    await act(() => hook.result.current.answer(true));
    expect(apply).not.toHaveBeenCalled();
    expect(hook.result.current.asking).toBe(false);
  });

  it("keeps the question open while a save runs, and ignores other ways of leaving meanwhile", async () => {
    let finish!: (ok: boolean) => void;
    const { apply, hook } = setup({ isDirty: () => true, save: () => new Promise<boolean>((resolve) => (finish = resolve)) });
    act(() => hook.result.current.select("b"));
    let answered!: Promise<void>;
    act(() => {
      answered = hook.result.current.answer(true);
    });
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    act(() => hook.result.current.select("c"));
    act(() => hook.result.current.keepEditing());
    expect(hook.result.current.asking).toBe(true);
    await act(async () => {
      finish(true);
      await answered;
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("b");
  });

  it("a panel that closed itself while the question was open has nothing to save", async () => {
    const { apply, hook } = setup({ isDirty: () => true });
    act(() => hook.result.current.select("b"));
    hook.result.current.panelApi.current = undefined;
    await act(() => hook.result.current.answer(true));
    expect(apply).toHaveBeenCalledWith("b");
  });

  it("a forced change skips the question and clears an open one", () => {
    const { apply, hook } = setup({ isDirty: () => true });
    act(() => hook.result.current.select("b"));
    act(() => hook.result.current.select(undefined, true));
    expect(apply).toHaveBeenCalledWith(undefined);
    expect(hook.result.current.asking).toBe(false);
  });
});
