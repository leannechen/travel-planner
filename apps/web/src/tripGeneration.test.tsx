// @vitest-environment jsdom
import type { Generation } from "@travel-planner/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { useTripGeneration } from "./tripGeneration";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  getGenerations: vi.fn(),
  getGeneration: vi.fn(),
  startGeneration: vi.fn(),
}));

const running: Generation = { id: "11111111-1111-4111-8111-111111111111", status: "running", tripId: null, failure: null };
const done: Generation = { ...running, status: "done", tripId: "22222222-2222-4222-8222-222222222222" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.getGenerations).mockResolvedValue({ remaining: 3, running: null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

// Lets the answers that are already there arrive.
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

describe("following an AI generation", () => {
  it("starts one, follows it until it is done and says whether the dialog was watching", async () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() => useTripGeneration(true, onFinished));
    await settle();
    expect(result.current.remaining).toBe(3);

    vi.mocked(api.startGeneration).mockResolvedValue(running);
    vi.mocked(api.getGeneration).mockResolvedValue(running);
    result.current.setWatching(true);
    await act(() => result.current.start({ prompt: "Kyoto", language: "en" }));
    expect(result.current).toMatchObject({ running: true, remaining: 2, lastPrompt: "Kyoto" });

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(onFinished).not.toHaveBeenCalled();

    vi.mocked(api.getGeneration).mockResolvedValue(done);
    vi.mocked(api.getGenerations).mockResolvedValue({ remaining: 2, running: null });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(onFinished).toHaveBeenCalledWith(done, true);
    expect(result.current.running).toBe(false);
    // The Trip was made, so the next prompt starts empty.
    expect(result.current.lastPrompt).toBe("");
  });

  it("keeps the prompt of a generation that failed, so it can be tried again", async () => {
    const { result } = renderHook(() => useTripGeneration(true, vi.fn()));
    await settle();
    vi.mocked(api.startGeneration).mockResolvedValue(running);
    vi.mocked(api.getGeneration).mockResolvedValue({ ...running, status: "failed", failure: "failed" });
    await act(() => result.current.start({ prompt: "Kyoto", language: "en" }));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current).toMatchObject({ failure: "failed", lastPrompt: "Kyoto" });
  });

  it("picks up a generation that was already running, and keeps why it failed", async () => {
    vi.mocked(api.getGenerations).mockResolvedValue({ remaining: 2, running });
    vi.mocked(api.getGeneration).mockResolvedValue({ ...running, status: "failed", failure: "unusable" });
    const onFinished = vi.fn();
    const { result } = renderHook(() => useTripGeneration(true, onFinished));
    await settle();
    expect(result.current.running).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(onFinished).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }), false);
    expect(result.current.failure).toBe("unusable");
  });

  it("asks nothing for a guest", async () => {
    renderHook(() => useTripGeneration(false, vi.fn()));
    await settle();
    expect(api.getGenerations).not.toHaveBeenCalled();
  });
});
