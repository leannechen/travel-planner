// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventImage } from "./api";
import { EventImage, TripIdContext } from "./eventImage";

vi.mock("./api", () => ({ getEventImage: vi.fn(async () => new Blob(["x"], { type: "image/png" })) }));

const EVENT = "00000000-0000-4000-8000-0000000000e1";
const FIRST = "00000000-0000-4000-8000-0000000000f1";
const SECOND = "00000000-0000-4000-8000-0000000000f2";

let counter = 0;
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => `blob:picture-${++counter}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

const view = (imageId: string | null) => (
  <TripIdContext.Provider value="trip-1">
    <EventImage event={{ id: EVENT, imageId, title: "Kiyomizu-dera" }} />
  </TripIdContext.Provider>
);

describe("the pictures kept for Events", () => {
  it("reads a picture once, and frees it when the Event's image is replaced or removed", async () => {
    const { rerender } = render(view(FIRST));
    expect((await screen.findByRole("img", { name: "Kiyomizu-dera" })).getAttribute("src")).toBe("blob:picture-1");

    // Shown again from what was read.
    rerender(view(FIRST));
    expect(getEventImage).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    rerender(view(SECOND));
    await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).toBe("blob:picture-2"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picture-1");

    rerender(view(null));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picture-2"));
    expect(screen.queryByRole("img")).toBeNull();
  });
});
