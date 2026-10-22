import { eventSchema, placePhotoSchema, shareLinkSchema, tripSchema } from "@travel-planner/shared";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test/test-app";
import { places } from "./db/schema";
import { fakePlaceProvider, getPlacePhoto, googlePlaceProvider, PlaceProviderError, type PlaceProvider } from "./places";

let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(async () => {
  await app.reset();
});
afterAll(() => app.stop());

const OWNER = "fake:lena@example.com";
const STRANGER = "fake:stranger@example.com";

function call(method: string, path: string, token: string | undefined, body?: unknown) {
  return fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : { "x-no-auth": "1" }), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function tripWithEvent(placeId: string | null) {
  const trip = tripSchema.parse(await (await call("POST", "/api/trips", OWNER, { title: "Kyoto" })).json());
  const event = eventSchema.parse(await (await call("POST", `/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, OWNER, { title: "Fushimi Inari", placeId })).json());
  return { trip, event, path: `/api/trips/${trip.id}/events/${event.id}/place-photo` };
}

describe("the place photo of an Event", () => {
  it("answers the photo, its authors and no stored picture for an Event with a place", async () => {
    const { path } = await tripWithEvent("fake:fushimi-inari");
    const res = await call("GET", path, OWNER);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const photo = placePhotoSchema.parse(await res.json());
    expect(photo.photoUri.startsWith("data:image/svg+xml")).toBe(true);
    expect(photo.authors).toEqual([{ name: "A fake photographer", uri: null }]);
    // Nothing is kept in the image store: the picture is shown from its address.
    expect(app.images.keys()).toEqual([]);
  });

  it("is 404 for an Event without a place, and for a place that has no photo", async () => {
    const none = await tripWithEvent(null);
    expect(((await (await call("GET", none.path, OWNER)).json()) as { code: string }).code).toBe("no_place_photo");
    const bare = await tripWithEvent("fake:beppu-port");
    expect((await call("GET", bare.path, OWNER)).status).toBe(404);
  });

  it("is not readable by someone who is not in the Trip", async () => {
    const { path } = await tripWithEvent("fake:fushimi-inari");
    expect((await call("GET", path, STRANGER)).status).toBe(404);
    expect((await call("GET", path, undefined)).status).toBe(401);
  });

  it("is readable through a share link that is on, for that Trip's Events only", async () => {
    const { trip, event } = await tripWithEvent("fake:fushimi-inari");
    const other = await tripWithEvent("fake:fushimi-inari");
    const link = shareLinkSchema.parse(await (await call("PUT", `/api/trips/${trip.id}/link`, OWNER, { enabled: true })).json());
    const url = (eventId: string) => `/api/shared/${link.token}/events/${eventId}/place-photo`;

    expect((await call("GET", url(event.id), undefined)).status).toBe(200);
    expect((await call("GET", url(other.event.id), undefined)).status).toBe(404);
    expect((await call("GET", `/api/shared/wrong-link/events/${event.id}/place-photo`, undefined)).status).toBe(404);

    await call("PUT", `/api/trips/${trip.id}/link`, OWNER, { enabled: false });
    expect((await call("GET", url(event.id), undefined)).status).toBe(404);
  });

  it("gives no photo, and asks Google for none, for an Event with an upload or whose photo was taken off", async () => {
    const asked: string[] = [];
    const counting = await startTestApp({ ...fakePlaceProvider(), getPhoto: async (id) => (asked.push(id), fakePlaceProvider().getPhoto(id)) });
    try {
      await counting.reset();
      const send = (method: string, path: string, body?: unknown, type = "application/json") =>
        fetch(`${counting.baseUrl}${path}`, { method, headers: { authorization: `Bearer ${OWNER}`, "content-type": type }, body: body === undefined ? undefined : (body as BodyInit) });
      const trip = tripSchema.parse(await (await send("POST", "/api/trips", JSON.stringify({ title: "Kyoto" }))).json());
      const create = async (title: string) =>
        eventSchema.parse(await (await send("POST", `/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, JSON.stringify({ title, placeId: "fake:fushimi-inari" }))).json());
      const withUpload = await create("Upload");
      const hidden = await create("Hidden");
      const shown = await create("Shown");
      const link = shareLinkSchema.parse(await (await call("PUT", `/api/trips/${trip.id}/link`, OWNER, { enabled: true })).json());

      const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#d33" } }).png().toBuffer();
      expect((await send("PUT", `/api/trips/${trip.id}/events/${withUpload.id}/image`, png, "image/png")).status).toBe(200);
      expect((await send("PATCH", `/api/trips/${trip.id}/events/${hidden.id}`, JSON.stringify({ placePhotoHidden: true }))).status).toBe(200);

      for (const event of [withUpload, hidden]) {
        expect((await send("GET", `/api/trips/${trip.id}/events/${event.id}/place-photo`)).status).toBe(404);
        expect((await fetch(`${counting.baseUrl}/api/shared/${link.token}/events/${event.id}/place-photo`)).status).toBe(404);
      }
      expect(asked).toEqual([]);
      expect((await send("GET", `/api/trips/${trip.id}/events/${shown.id}/place-photo`)).status).toBe(200);
      expect(asked).toEqual(["fake:fushimi-inari"]);
    } finally {
      await counting.stop();
    }
  });

  it("does not hand out the photo of another Trip's Event, or of an Archived Event through the link", async () => {
    const mine = await tripWithEvent("fake:fushimi-inari");
    const other = await tripWithEvent("fake:fushimi-inari");
    expect((await call("GET", `/api/trips/${mine.trip.id}/events/${other.event.id}/place-photo`, OWNER)).status).toBe(404);

    const link = shareLinkSchema.parse(await (await call("PUT", `/api/trips/${mine.trip.id}/link`, OWNER, { enabled: true })).json());
    const shared = `/api/shared/${link.token}/events/${mine.event.id}/place-photo`;
    expect((await call("GET", shared, undefined)).status).toBe(200);
    await call("PATCH", `/api/trips/${mine.trip.id}/events/${mine.event.id}`, OWNER, { area: "archive" });
    expect((await call("GET", shared, undefined)).status).toBe(404);
  });

  it("keeps the choice to hide the photo on the Event, and keeps it when the place changes", async () => {
    const { trip, event } = await tripWithEvent("fake:fushimi-inari");
    expect(event.placePhotoHidden).toBe(false);
    const patch = (body: object) => call("PATCH", `/api/trips/${trip.id}/events/${event.id}`, OWNER, body);

    expect(eventSchema.parse(await (await patch({ placePhotoHidden: true })).json()).placePhotoHidden).toBe(true);
    expect(eventSchema.parse(await (await patch({ placeId: "fake:kinkaku-ji" })).json()).placePhotoHidden).toBe(true);
    expect(eventSchema.parse(await (await patch({ placePhotoHidden: false })).json()).placePhotoHidden).toBe(false);
  });

  it("answers 502 when the provider cannot be reached", async () => {
    const failing = await startTestApp({
      ...fakePlaceProvider(),
      getPhoto: () => Promise.reject(new PlaceProviderError("Place photo failed (503)")),
    });
    try {
      await failing.reset();
      const call2 = (method: string, path: string, body?: unknown) =>
        fetch(`${failing.baseUrl}${path}`, {
          method,
          headers: { authorization: `Bearer ${OWNER}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      const trip = tripSchema.parse(await (await call2("POST", "/api/trips", { title: "Kyoto" })).json());
      const event = eventSchema.parse(await (await call2("POST", `/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, { title: "x", placeId: "fake:fushimi-inari" })).json());
      expect((await call2("GET", `/api/trips/${trip.id}/events/${event.id}/place-photo`)).status).toBe(502);
    } finally {
      await failing.stop();
    }
  });
});

describe("the place photo cache", () => {
  function counting(inner: PlaceProvider = fakePlaceProvider()) {
    const calls = { photo: 0, uri: 0 };
    const provider: PlaceProvider = {
      ...inner,
      getPhoto: (id) => (calls.photo++, inner.getPhoto(id)),
      getPhotoUri: (ref) => (calls.uri++, inner.getPhotoUri(ref)),
    };
    return { provider, calls };
  }

  it("keeps the provider's reference, not the picture, and asks for the address each time", async () => {
    const { provider, calls } = counting();
    await getPlacePhoto(app.db, provider, "fake:fushimi-inari");
    await getPlacePhoto(app.db, provider, "fake:fushimi-inari");
    expect(calls).toEqual({ photo: 1, uri: 2 });
    const [row] = await app.db.select().from(places).where(eq(places.id, "fake:fushimi-inari"));
    expect(row!.photo).toEqual({ name: "fake:Fushimi Inari Taisha", authors: [{ name: "A fake photographer", uri: null }] });
  });

  it("remembers a place without a photo, until the cache is old", async () => {
    const { provider, calls } = counting();
    expect(await getPlacePhoto(app.db, provider, "fake:beppu-port")).toBeUndefined();
    expect(await getPlacePhoto(app.db, provider, "fake:beppu-port")).toBeUndefined();
    expect(calls.photo).toBe(1);
    // 31 days later it is asked again.
    expect(await getPlacePhoto(app.db, provider, "fake:beppu-port", new Date(Date.now() + 31 * 24 * 3600 * 1000))).toBeUndefined();
    expect(calls.photo).toBe(2);
  });

  it("looks the reference up again once when the kept one no longer works", async () => {
    const inner = fakePlaceProvider();
    let stale = true;
    const provider: PlaceProvider = {
      ...inner,
      getPhoto: async (id) => {
        const ref = await inner.getPhoto(id);
        return ref && { ...ref, name: stale ? "fake:" : ref.name };
      },
      getPhotoUri: async (ref) => (ref.name === "fake:" ? undefined : inner.getPhotoUri(ref)),
    };
    // The first reference is already dead, so there is nothing to show and it is kept as it is.
    expect(await getPlacePhoto(app.db, provider, "fake:fushimi-inari")).toBeUndefined();
    stale = false;
    const photo = await getPlacePhoto(app.db, provider, "fake:fushimi-inari");
    expect(photo?.photoUri.startsWith("data:image/svg+xml")).toBe(true);
  });
});

describe("Google place photos", () => {
  const name = "places/ChIJabc/photos/AUacShh3_Dd8";

  function google(responses: Record<string, { status?: number; body?: unknown }>) {
    const seen: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      seen.push(String(url));
      const found = Object.entries(responses).find(([part]) => String(url).includes(part))?.[1];
      if (!found) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(found.body ?? {}), { status: found.status ?? 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { provider: googlePlaceProvider("key", fetchFn), seen };
  }

  it("reads the first photo and credits its authors, with https addresses only", async () => {
    const { provider, seen } = google({
      "places/ChIJabc": {
        body: {
          id: "ChIJabc",
          photos: [
            { name, authorAttributions: [{ displayName: "John Smith", uri: "//maps.google.com/maps/contrib/101563" }, { displayName: "No Link", uri: "javascript:alert(1)" }, { uri: "https://x" }] },
            { name: "places/ChIJabc/photos/second" },
          ],
        },
      },
    });
    expect(await provider.getPhoto("ChIJabc")).toEqual({
      name,
      authors: [
        { name: "John Smith", uri: "https://maps.google.com/maps/contrib/101563" },
        { name: "No Link", uri: null },
      ],
    });
    expect(seen).toEqual(["https://places.googleapis.com/v1/places/ChIJabc"]);
  });

  it("has no photo for a place without one", async () => {
    expect(await google({ "places/ChIJabc": { body: { id: "ChIJabc" } } }).provider.getPhoto("ChIJabc")).toBeUndefined();
    expect(await google({}).provider.getPhoto("ChIJabc")).toBeUndefined();
  });

  it("asks for the picture's address without following the redirect, and drops other schemes", async () => {
    const ok = google({ "/media": { body: { name: `${name}/media`, photoUri: "https://lh3.googleusercontent.com/p/abc" } } });
    expect(await ok.provider.getPhotoUri({ name, authors: [] })).toBe("https://lh3.googleusercontent.com/p/abc");
    expect(ok.seen[0]).toBe(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=1200&skipHttpRedirect=true`);

    const odd = google({ "/media": { body: { photoUri: "http://insecure.example/p" } } });
    await expect(odd.provider.getPhotoUri({ name, authors: [] })).rejects.toThrow(PlaceProviderError);
    // An answer that is not an object at all is a failure of the provider too, not a crash.
    await expect(google({ "/media": { body: null } }).provider.getPhotoUri({ name, authors: [] })).rejects.toThrow(PlaceProviderError);
  });

  it("says a photo is gone when Google answers 400 or 404 for it", async () => {
    expect(await google({ "/media": { status: 404 } }).provider.getPhotoUri({ name, authors: [] })).toBeUndefined();
    expect(await google({ "/media": { status: 400 } }).provider.getPhotoUri({ name, authors: [] })).toBeUndefined();
  });

  it("does not send a reference that is not a photo name, and says a gone photo is gone", async () => {
    const { provider, seen } = google({});
    expect(await provider.getPhotoUri({ name: "places/x/../../other", authors: [] })).toBeUndefined();
    expect(seen).toEqual([]);
    expect(await provider.getPhotoUri({ name, authors: [] })).toBeUndefined();
  });
});
