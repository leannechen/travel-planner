// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import type { Place } from "@travel-planner/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlaces } from "./api";
import { usePlaces } from "./placeCache";

vi.mock("./api", () => ({ getPlaces: vi.fn() }));

const place = (id: string): Place => ({ id, name: id, address: "", area: "", lat: 35, lng: 135 });

afterEach(() => vi.clearAllMocks());

describe("usePlaces", () => {
  it("looks places up, and keeps the same Map until the ids or what is known change", async () => {
    vi.mocked(getPlaces).mockImplementation(async (ids) => ids.map(place));
    const { result, rerender } = renderHook(({ ids }) => usePlaces(ids), { initialProps: { ids: ["cache-a", "cache-b"] } });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect([...result.current.places.keys()].sort()).toEqual(["cache-a", "cache-b"]);

    const first = result.current.places;
    // A new array with the same ids, in another order: nothing changed.
    rerender({ ids: ["cache-b", "cache-a"] });
    expect(result.current.places).toBe(first);

    rerender({ ids: ["cache-a"] });
    expect([...result.current.places.keys()]).toEqual(["cache-a"]);
    expect(result.current.places).not.toBe(first);
  });

  it("only asks for places it does not know yet, and says when a lookup failed", async () => {
    vi.mocked(getPlaces).mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => usePlaces(["cache-missing"]));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.places.size).toBe(0);
  });
});
