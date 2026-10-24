// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_IMAGE_BYTES, type Event } from "@travel-planner/shared";
import { createRef, type MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlacePhoto } from "./api";
import { TripIdContext } from "./eventImage";
import { EventPanel, type PanelApi } from "./EventPanel";
import { makeDay, makeEvent, renderApp, setPhone } from "./test-helpers";

vi.mock("./api", () => ({
  searchPlaces: vi.fn(async () => []),
  getPlaces: vi.fn(async () => []),
  getEventImage: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
  getPlacePhoto: vi.fn(),
}));
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ label }: { label: string }) => <textarea aria-label={label} />,
}));

const days = [makeDay(1)];
const png = () => new File(["png"], "kiyomizu.png", { type: "image/png" });

type ChangeImage = (eventId: string, change: { file: File } | "remove") => Promise<Event>;

function setup(event: Event | undefined | null = makeEvent({ dayId: days[0]!.id, holding: null }), changeImage?: ChangeImage) {
  event ??= undefined;
  const apiRef = createRef<PanelApi | undefined>() as MutableRefObject<PanelApi | undefined>;
  const props = {
    days,
    event,
    newEvent: event ? undefined : { dayId: days[0]!.id, startMinute: 600, durationMinutes: 60 },
    onCreate: vi.fn(async (input: Record<string, unknown>) => ({ ...makeEvent(), ...input }) as Event),
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
    onChangeImage: vi.fn<ChangeImage>(
      changeImage ?? (async (eventId, change) => ({ ...makeEvent({ id: eventId }), imageId: change === "remove" ? null : "00000000-0000-4000-8000-0000000000aa" })),
    ),
  };
  renderApp(
    <TripIdContext.Provider value="trip-1">
      <EventPanel {...props} />
    </TripIdContext.Provider>,
  );
  return props;
}

beforeEach(() => {
  setPhone(false);
  URL.createObjectURL = vi.fn(() => "blob:picture");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

const save = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /^(Save|Add Event)$/ }));

describe("Image section of the Event panel", () => {
  it("offers Add image when the Event has none", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Image" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add image" })).toBeTruthy();
    expect(screen.getByText("JPEG, PNG or WebP, up to 5 MB.")).toBeTruthy();
  });

  it("previews a chosen picture and uploads it only when Save is pressed", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.upload(screen.getByTestId("image-input"), png());

    expect(screen.getByRole("button", { name: "Show the image larger" })).toBeTruthy();
    expect(screen.getByText("Your image")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace" })).toBeTruthy();
    expect(props.apiRef.current!.isDirty()).toBe(true);
    expect(props.onChangeImage).not.toHaveBeenCalled();

    await save(user);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(props.onChangeImage).toHaveBeenCalledWith(expect.any(String), { file: expect.objectContaining({ name: "kiyomizu.png" }) });
  });

  it("leaves the Event's image alone when the panel is cancelled", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.upload(screen.getByTestId("image-input"), png());
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onClose).toHaveBeenCalledWith(true);
    expect(props.onChangeImage).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a JPEG, PNG or WebP picture", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const props = setup();
    await user.upload(screen.getByTestId("image-input"), new File(["gif"], "a.gif", { type: "image/gif" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Choose a JPEG, PNG or WebP picture.");
    expect(screen.getByRole("button", { name: "Add image" })).toBeTruthy();
    expect(props.apiRef.current!.isDirty()).toBe(false);
  });

  it("refuses a file larger than 5 MB", async () => {
    const user = userEvent.setup();
    setup();
    const big = png();
    Object.defineProperty(big, "size", { value: MAX_IMAGE_BYTES + 1 });
    await user.upload(screen.getByTestId("image-input"), big);

    expect((await screen.findByRole("alert")).textContent).toBe("That picture is larger than 5 MB.");
    expect(screen.queryByText("Your image")).toBeNull();
  });

  it("shows the saved image, and Remove waits for Save", async () => {
    const user = userEvent.setup();
    const event = makeEvent({ dayId: days[0]!.id, holding: null, imageId: "00000000-0000-4000-8000-0000000000bb" });
    const props = setup(event);
    expect(await screen.findByText("Your image")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("The image is removed when you save.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add image" })).toBeTruthy();
    expect(props.onChangeImage).not.toHaveBeenCalled();

    await save(user);
    await waitFor(() => expect(props.onChangeImage).toHaveBeenCalledWith(event.id, "remove"));
  });

  it("keeps the panel open with the error when the upload fails, and Save tries again", async () => {
    const user = userEvent.setup();
    const changeImage = vi.fn<ChangeImage>().mockRejectedValueOnce(new Error("The picture is larger than 5 MB")).mockResolvedValue(makeEvent());
    const props = setup(null, changeImage);
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Kiyomizu-dera");
    await user.upload(screen.getByTestId("image-input"), png());
    await save(user);

    expect((await screen.findByRole("alert")).textContent).toBe("The picture is larger than 5 MB");
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.apiRef.current!.isDirty()).toBe(true);

    await save(user);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    // The Event was created once; only the upload was repeated.
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(changeImage).toHaveBeenCalledTimes(2);
  });

  it("shows the server's refusal of a picture in the interface language, not its English text", async () => {
    const user = userEvent.setup();
    const refusal = Object.assign(new Error("The picture is larger than 5 MB"), { code: "image_too_large" });
    setup(undefined, vi.fn<ChangeImage>().mockRejectedValue(refusal));
    await user.upload(screen.getByTestId("image-input"), png());
    await save(user);

    expect((await screen.findByRole("alert")).textContent).toBe("That picture is larger than 5 MB.");
  });

  it.each([
    ["upload_limit", { window: "minute" }, "Too many pictures uploaded. Try again in a minute."],
    ["upload_limit", { window: "day" }, "Today's picture uploads are used up. Try again tomorrow."],
    ["image_count_limit", {}, "This Trip's owner has reached the limit of stored pictures. A picture has to be removed first."],
  ])("explains the limit %s %j in the interface language", async (code, detail, text) => {
    const user = userEvent.setup();
    const refusal = Object.assign(new Error("server text"), { code, detail });
    setup(undefined, vi.fn<ChangeImage>().mockRejectedValue(refusal));
    await user.upload(screen.getByTestId("image-input"), png());
    await save(user);

    expect((await screen.findByRole("alert")).textContent).toBe(text);
  });

  it("does not lose a picture chosen for a new Event without a title", async () => {
    const user = userEvent.setup();
    const props = setup(null);
    await user.upload(screen.getByTestId("image-input"), png());

    expect(props.apiRef.current!.isDirty()).toBe(true);
    expect(await props.apiRef.current!.save()).toBe(false);
    expect((await screen.findByRole("alert")).textContent).toBe("Enter a title to save this Event");
    expect(props.onChangeImage).not.toHaveBeenCalled();
  });
});

describe("large view of the image", () => {
  async function openLarge(user: ReturnType<typeof userEvent.setup>) {
    const props = setup();
    await user.upload(screen.getByTestId("image-input"), png());
    const preview = screen.getByRole("button", { name: "Show the image larger" });
    await user.click(preview);
    return { props, preview };
  }

  it("opens on click as a dialog with the picture", async () => {
    const user = userEvent.setup();
    await openLarge(user);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img")).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close the image" }));
  });

  it("closes with Esc without closing the panel, and gives the focus back", async () => {
    const user = userEvent.setup();
    const { props, preview } = await openLarge(user);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(preview);
  });

  it("closes with the close button and with a click outside the picture, but not on the picture", async () => {
    const user = userEvent.setup();
    await openLarge(user);
    await user.click(within(screen.getByRole("dialog")).getByRole("img"));
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Close the image" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show the image larger" }));
    await user.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the keys away from the page while it is open", async () => {
    const user = userEvent.setup();
    const pressed = vi.fn();
    window.addEventListener("keydown", pressed);
    await openLarge(user);
    await user.keyboard("n");
    window.removeEventListener("keydown", pressed);

    expect(pressed).not.toHaveBeenCalled();
  });

  it("can be opened with the keyboard", async () => {
    const user = userEvent.setup();
    setup();
    await user.upload(screen.getByTestId("image-input"), png());
    screen.getByRole("button", { name: "Show the image larger" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("place photo in the Image section (design 26)", () => {
  const PHOTO = { photoUri: "https://photos.example/fushimi.jpg", authors: [{ name: "Ann", uri: "https://maps.google.com/contrib/1" }], mapsUri: "https://maps.example/p" };
  const withPlace = (overrides: Partial<Event> = {}) => makeEvent({ dayId: days[0]!.id, holding: null, placeId: "ChIJfushimi", ...overrides });

  beforeEach(() => {
    vi.mocked(getPlacePhoto).mockReset();
    vi.mocked(getPlacePhoto).mockResolvedValue(PHOTO);
  });

  it("shows the place photo with its label and credit when the Event has a place and no upload", async () => {
    setup(withPlace());
    expect(await screen.findByText("Place photo · Google")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ann" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View on Google Maps" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace" })).toBeTruthy();
    expect(screen.queryByText("Your image")).toBeNull();
  });

  it("shows no place photo for an Event without a place, or one that has an upload", async () => {
    setup(makeEvent({ dayId: days[0]!.id, holding: null }));
    expect(screen.getByRole("button", { name: "Add image" })).toBeTruthy();
    cleanup();
    setup(withPlace({ imageId: "00000000-0000-4000-8000-0000000000bb" }));
    expect(await screen.findByText("Your image")).toBeTruthy();
    expect(getPlacePhoto).not.toHaveBeenCalled();
  });

  it("Remove takes the place photo off too, and Use place photo brings it back, both on Save", async () => {
    const user = userEvent.setup();
    const event = withPlace();
    const props = setup(event);
    await screen.findByText("Place photo · Google");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("Place photo · Google")).toBeNull();
    expect(screen.getByRole("button", { name: "Use place photo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add image" })).toBeTruthy();
    expect(props.apiRef.current!.isDirty()).toBe(true);
    // Nothing is sent before Save, and there is no upload to delete.
    expect(props.onUpdate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Use place photo" }));
    expect(await screen.findByText("Place photo · Google")).toBeTruthy();
    expect(props.apiRef.current!.isDirty()).toBe(false);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await save(user);
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(event.id, { placePhotoHidden: true }));
    expect(props.onChangeImage).not.toHaveBeenCalled();
  });

  it("offers nothing while the place photo is still being asked for", async () => {
    let answer: (photo: typeof PHOTO) => void = () => undefined;
    vi.mocked(getPlacePhoto).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    setup(withPlace());
    expect((screen.getByRole("button", { name: "Add image" }) as HTMLButtonElement).disabled).toBe(true);
    answer(PHOTO);
    expect(await screen.findByText("Place photo · Google")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Replace" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains the empty state after Remove, and Use place photo shows the photo of the saved place at once", async () => {
    const user = userEvent.setup();
    const event = withPlace({ placePhotoHidden: true });
    setup(event);
    expect(screen.getByText("No image. Use place photo brings the Google photo back.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use place photo" }));
    // The same place as saved: its photo is shown at once.
    expect(await screen.findByText("Place photo · Google")).toBeTruthy();
  });

  it("says the photo comes back, not only that the image goes, after removing a saved upload of an Event with a place", async () => {
    const user = userEvent.setup();
    setup(withPlace({ imageId: "00000000-0000-4000-8000-0000000000bb" }));
    await screen.findByText("Your image");
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("No image. Use place photo brings the Google photo back.")).toBeTruthy();
  });

  it("opens the large view with the credit", async () => {
    const user = userEvent.setup();
    setup(withPlace());
    await user.click(await screen.findByRole("button", { name: "Show the image larger" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Ann" })).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "View on Google Maps" })).toBeTruthy();
  });

  it("uploads over a place photo and does not bring it back when the upload is removed", async () => {
    const user = userEvent.setup();
    const props = setup(withPlace());
    await screen.findByText("Place photo · Google");
    await user.upload(screen.getByTestId("image-input"), png());
    expect(screen.getByText("Your image")).toBeTruthy();
    expect(screen.queryByText("Place photo · Google")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("Place photo · Google")).toBeNull();
    expect(screen.getByRole("button", { name: "Use place photo" })).toBeTruthy();
    expect(props.onChangeImage).not.toHaveBeenCalled();
  });
});
