// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventImage, getPlacePhoto } from "./api";
import { EventThumb, PhotoCredit, TripIdContext } from "./eventImage";
import { PreferencesProvider } from "./preferences";

vi.mock("./api", () => ({
  getEventImage: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
  getPlacePhoto: vi.fn(async () => ({ photoUri: "https://photos.example/a.jpg", authors: [{ name: "Ann", uri: "https://maps.google.com/contrib/1" }], mapsUri: "https://maps.example/p" })),
}));

const EVENT = "00000000-0000-4000-8000-0000000000e1";
const FIRST = "00000000-0000-4000-8000-0000000000f1";
const SECOND = "00000000-0000-4000-8000-0000000000f2";

let counter = 0;
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => `blob:picture-${++counter}`);
  URL.revokeObjectURL = vi.fn();
  vi.mocked(getPlacePhoto).mockReset();
  vi.mocked(getPlacePhoto).mockResolvedValue({ photoUri: "https://photos.example/a.jpg", authors: [], mapsUri: null });
});
afterEach(cleanup);

type Overrides = { imageId?: string | null; placeId?: string | null; placePhotoHidden?: boolean; id?: string };
const view = ({ imageId = null, placeId = null, placePhotoHidden = false, id = EVENT }: Overrides) => (
  <PreferencesProvider>
    <TripIdContext.Provider value="trip-1">
      <EventThumb event={{ id, imageId, placeId, placePhotoHidden, kind: "attraction", transportLabel: null }} />
    </TripIdContext.Provider>
  </PreferencesProvider>
);
const thumb = (container: HTMLElement) => container.querySelector<HTMLImageElement>("img.event-thumb");
const tile = (container: HTMLElement) => container.querySelector(".event-thumb-tile");

describe("the pictures kept for Events", () => {
  it("reads a picture once, and frees it when the Event's image is replaced or removed", async () => {
    const { rerender, container } = render(view({ imageId: FIRST }));
    await waitFor(() => expect(thumb(container)?.getAttribute("src")).toBe("blob:picture-1"));

    // Shown again from what was read.
    rerender(view({ imageId: FIRST }));
    expect(getEventImage).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    rerender(view({ imageId: SECOND }));
    await waitFor(() => expect(thumb(container)?.getAttribute("src")).toBe("blob:picture-2"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picture-1");

    rerender(view({ imageId: null }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picture-2"));
    expect(thumb(container)).toBeNull();
    expect(tile(container)).not.toBeNull();
  });
});

describe("the picture of an Event: upload, place photo, kind icon", () => {
  it("shows the kind's icon on a tile when there is no upload and no place", () => {
    const { container } = render(view({ id: "00000000-0000-4000-8000-0000000000a1" }));
    expect(tile(container)).not.toBeNull();
    expect(getPlacePhoto).not.toHaveBeenCalled();
  });

  it("shows the place photo when the Event has a place and no upload", async () => {
    const { container } = render(view({ id: "00000000-0000-4000-8000-0000000000a2", placeId: "ChIJa" }));
    expect(tile(container)).not.toBeNull();
    await waitFor(() => expect(thumb(container)?.getAttribute("src")).toBe("https://photos.example/a.jpg"));
    expect(getPlacePhoto).toHaveBeenCalledWith("trip-1", "00000000-0000-4000-8000-0000000000a2");
  });

  it("prefers the upload to the place photo, without asking Google", async () => {
    const { container } = render(view({ id: "00000000-0000-4000-8000-0000000000a3", placeId: "ChIJa", imageId: FIRST }));
    await waitFor(() => expect(thumb(container)?.getAttribute("src")).toMatch(/^blob:/));
    expect(getPlacePhoto).not.toHaveBeenCalled();
  });

  it("does not show or ask for the place photo once it was taken off", () => {
    const { container } = render(view({ id: "00000000-0000-4000-8000-0000000000a4", placeId: "ChIJa", placePhotoHidden: true }));
    expect(tile(container)).not.toBeNull();
    expect(getPlacePhoto).not.toHaveBeenCalled();
  });

  it("keeps the tile for a place without a photo, and asks only once for it", async () => {
    vi.mocked(getPlacePhoto).mockResolvedValue(null);
    const event = "00000000-0000-4000-8000-0000000000a5";
    const { container, rerender } = render(view({ id: event, placeId: "ChIJb" }));
    await waitFor(() => expect(getPlacePhoto).toHaveBeenCalledTimes(1));
    rerender(view({ id: event, placeId: "ChIJb" }));
    expect(tile(container)).not.toBeNull();
    expect(getPlacePhoto).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failed request", async () => {
    vi.mocked(getPlacePhoto).mockRejectedValueOnce(new Error("down"));
    const event = "00000000-0000-4000-8000-0000000000a6";
    const { container, unmount } = render(view({ id: event, placeId: "ChIJc" }));
    await waitFor(() => expect(getPlacePhoto).toHaveBeenCalledTimes(1));
    expect(tile(container)).not.toBeNull();
    unmount();
    const again = render(view({ id: event, placeId: "ChIJc" }));
    await waitFor(() => expect(thumb(again.container)).not.toBeNull());
  });
});

describe("the credit for a place photo", () => {
  it("names the authors, links to their page and to the place on Google Maps", () => {
    render(
      <PreferencesProvider>
        <PhotoCredit photo={{ photoUri: "x", authors: [{ name: "Ann", uri: "https://maps.google.com/contrib/1" }, { name: "Bo", uri: null }], mapsUri: "https://maps.example/p" }} />
      </PreferencesProvider>,
    );
    expect(screen.getByRole("link", { name: "Ann" }).getAttribute("href")).toBe("https://maps.google.com/contrib/1");
    expect(screen.queryByRole("link", { name: "Bo" })).toBeNull();
    expect(screen.getByText(/Bo/)).toBeTruthy();
    const maps = screen.getByRole("link", { name: "View on Google Maps" });
    expect(maps.getAttribute("href")).toBe("https://maps.example/p");
    expect(maps.getAttribute("rel")).toContain("noopener");
  });
});
