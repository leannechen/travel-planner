import { eventSchema, invitationSchema, shareLinkSchema, tripSchema, MAX_IMAGE_BYTES, deletedEventSchema } from "@travel-planner/shared";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test/test-app";
import { GUEST_HEADER } from "./auth";
import { prepareImage } from "./images";

let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(async () => {
  await app.reset();
});
afterAll(() => app.stop());

const OWNER = "fake:lena@example.com";
const MEI = "fake:mei@example.com";
const STRANGER = "fake:stranger@example.com";

function call(method: string, path: string, token: string | undefined, body?: unknown) {
  return fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : { "x-no-auth": "1" }), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// A real picture of the given size, as a PNG or JPEG.
const picture = (width = 8, height = 6, format: "png" | "jpeg" | "webp" = "png") => {
  const blank = sharp({ create: { width, height, channels: 3, background: "#d33" } });
  return blank[format]().toBuffer();
};

function upload(path: string, token: string | undefined, bytes: Buffer | string, type = "image/png") {
  return fetch(`${app.baseUrl}${path}`, {
    method: "PUT",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : { "x-no-auth": "1" }), "content-type": type },
    body: bytes as BodyInit,
  });
}

async function tripWithEvent() {
  const trip = tripSchema.parse(await (await call("POST", "/api/trips", OWNER, { title: "Kyoto" })).json());
  const event = eventSchema.parse(await (await call("POST", `/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, OWNER, { title: "Fushimi Inari" })).json());
  return { trip, event, path: `/api/trips/${trip.id}/events/${event.id}/image` };
}

describe("uploading an Event image", () => {
  it("stores the picture, gives the Event its image id and serves the picture back", async () => {
    const { trip, event, path } = await tripWithEvent();
    expect(event.imageId).toBeNull();

    const res = await upload(path, OWNER, await picture(8, 6, "png"));
    expect(res.status).toBe(200);
    const updated = eventSchema.parse(await res.json());
    expect(updated.imageId).not.toBeNull();
    expect(app.images.keys()).toEqual([updated.imageId]);

    const read = await call("GET", path, OWNER);
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await sharp(Buffer.from(await read.arrayBuffer())).metadata()).width).toBe(8);

    // The Trip carries the id too.
    const trips = tripSchema.array().parse(await (await call("GET", "/api/trips", OWNER)).json());
    expect(trips.find((t) => t.id === trip.id)!.days[0]!.events[0]!.imageId).toBe(updated.imageId);
  });

  it("accepts JPEG and WebP too", async () => {
    const { path } = await tripWithEvent();
    for (const format of ["jpeg", "webp"] as const) {
      const res = await upload(path, OWNER, await picture(8, 6, format), `image/${format}`);
      expect(res.status).toBe(200);
      expect((await call("GET", path, OWNER)).headers.get("content-type")).toBe(`image/${format}`);
    }
  });

  it("replaces the image: a new id, and the old file is deleted", async () => {
    const { path } = await tripWithEvent();
    const first = eventSchema.parse(await (await upload(path, OWNER, await picture())).json());
    const second = eventSchema.parse(await (await upload(path, OWNER, await picture(10, 10))).json());

    expect(second.imageId).not.toBe(first.imageId);
    expect(app.images.keys()).toEqual([second.imageId]);
    expect((await sharp(Buffer.from(await (await call("GET", path, OWNER)).arrayBuffer())).metadata()).width).toBe(10);
  });

  it("removes the image and its file", async () => {
    const { path } = await tripWithEvent();
    await upload(path, OWNER, await picture());

    const res = await call("DELETE", path, OWNER);
    expect(res.status).toBe(200);
    expect(eventSchema.parse(await res.json()).imageId).toBeNull();
    expect(app.images.keys()).toEqual([]);
    expect((await call("GET", path, OWNER)).status).toBe(404);
    // Removing again changes nothing.
    expect((await call("DELETE", path, OWNER)).status).toBe(200);
  });

  it("refuses what is not a JPEG, PNG or WebP picture, whatever the sender says", async () => {
    const { path } = await tripWithEvent();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>';
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).gif().toBuffer();
    for (const [bytes, type] of [
      ["just some text", "image/png"],
      [svg, "image/svg+xml"],
      [svg, "image/png"],
      [gif, "image/gif"],
      ["", "image/png"],
    ] as const) {
      const res = await upload(path, OWNER, bytes, type);
      expect(res.status).toBe(415);
      expect(((await res.json()) as { code: string }).code).toBe("image_type");
    }
    expect(app.images.keys()).toEqual([]);
  });

  it("goes by what the bytes are, not by the label the sender gave them", async () => {
    const { path } = await tripWithEvent();
    const res = await upload(path, OWNER, await picture(), "application/octet-stream");
    expect(res.status).toBe(200);
    expect((await call("GET", path, OWNER)).headers.get("content-type")).toBe("image/png");
  });

  it("refuses a file larger than the limit", async () => {
    const { path } = await tripWithEvent();
    const res = await upload(path, OWNER, Buffer.alloc(MAX_IMAGE_BYTES + 1, 1));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe("image_too_large");
    expect(app.images.keys()).toEqual([]);
  });

  it("is not open to someone else, and a missing Event is 404", async () => {
    const { event, path, trip } = await tripWithEvent();
    await upload(path, OWNER, await picture());

    expect((await upload(path, STRANGER, await picture())).status).toBe(404);
    expect((await call("GET", path, STRANGER)).status).toBe(404);
    expect((await call("DELETE", path, STRANGER)).status).toBe(404);
    expect((await call("GET", path, undefined)).status).toBe(401);
    expect((await upload(`/api/trips/${trip.id}/events/${crypto.randomUUID()}/image`, OWNER, await picture())).status).toBe(404);
    expect(event.id).toBeTruthy();
    expect(app.images.keys()).toHaveLength(1);
  });

  it("lets an Editor upload", async () => {
    const { trip, path } = await tripWithEvent();
    const invitation = invitationSchema.parse(await (await call("POST", `/api/trips/${trip.id}/invitations`, OWNER, { email: "mei@example.com" })).json());
    expect((await call("POST", `/api/invitations/${invitation.token}/accept`, MEI)).status).toBe(200);

    expect((await upload(path, MEI, await picture())).status).toBe(200);
    expect((await call("GET", path, MEI)).status).toBe(200);
  });

  it("does not let the Event update or create set the image id", async () => {
    const { trip, event, path } = await tripWithEvent();
    await call("PATCH", `/api/trips/${trip.id}/events/${event.id}`, OWNER, { title: "Fushimi", imageId: crypto.randomUUID() });
    const events = tripSchema.array().parse(await (await call("GET", "/api/trips", OWNER)).json())[0]!.days[0]!.events;
    expect(events[0]!.imageId).toBeNull();
    expect((await call("GET", path, OWNER)).status).toBe(404);
  });
});

describe("what happens to the image with its Event", () => {
  it("deletes the file with the Event, and undo brings the Event back without it", async () => {
    const { trip, event, path } = await tripWithEvent();
    await upload(path, OWNER, await picture());
    expect(app.images.keys()).toHaveLength(1);

    const res = await call("DELETE", `/api/trips/${trip.id}/events/${event.id}`, OWNER);
    expect(res.status).toBe(200);
    const deleted = deletedEventSchema.parse(await res.json());
    expect(app.images.keys()).toEqual([]);

    const restored = await call("POST", `/api/trips/${trip.id}/events/restore`, OWNER, deleted);
    expect(restored.status).toBe(201);
    expect(eventSchema.parse(await restored.json()).imageId).toBeNull();
  });

  it("keeps the image when the Event is archived or moved to the Backlog", async () => {
    const { trip, event, path } = await tripWithEvent();
    const uploaded = eventSchema.parse(await (await upload(path, OWNER, await picture())).json());
    const moved = eventSchema.parse(await (await call("PATCH", `/api/trips/${trip.id}/events/${event.id}`, OWNER, { area: "backlog" })).json());
    expect(moved.imageId).toBe(uploaded.imageId);
    expect(app.images.keys()).toEqual([uploaded.imageId]);
  });
});

describe("a guest who logs in", () => {
  it("keeps the images of the guest's Events when the guest is merged into the account", async () => {
    const guest = { [GUEST_HEADER]: crypto.randomUUID() };
    const json = { ...guest, "content-type": "application/json" };
    const trip = tripSchema.parse(await (await fetch(`${app.baseUrl}/api/trips`, { method: "POST", headers: json, body: JSON.stringify({ title: "Kyoto" }) })).json());
    const created = await fetch(`${app.baseUrl}/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, { method: "POST", headers: json, body: JSON.stringify({ title: "Fushimi Inari" }) });
    const event = eventSchema.parse(await created.json());
    const path = `/api/trips/${trip.id}/events/${event.id}/image`;
    const put = await fetch(`${app.baseUrl}${path}`, { method: "PUT", headers: { ...guest, "content-type": "image/png" }, body: (await picture()) as BodyInit });
    const uploaded = eventSchema.parse(await put.json());

    const merged = await fetch(`${app.baseUrl}/api/me/merge-guest`, { method: "POST", headers: { ...guest, authorization: `Bearer ${OWNER}` } });
    expect(merged.status).toBe(200);

    expect((await call("GET", path, OWNER)).status).toBe(200);
    const trips = tripSchema.array().parse(await (await call("GET", "/api/trips", OWNER)).json());
    expect(trips[0]!.days[0]!.events[0]!.imageId).toBe(uploaded.imageId);
    expect(app.images.keys()).toEqual([uploaded.imageId]);
  });
});

describe("a Viewer reading the image", () => {
  async function shared() {
    const { trip, event, path } = await tripWithEvent();
    await upload(path, OWNER, await picture());
    const link = shareLinkSchema.parse(await (await call("PUT", `/api/trips/${trip.id}/link`, OWNER, { enabled: true })).json());
    return { trip, event, path, link, url: `/api/shared/${link.token}/events/${event.id}/image` };
  }

  it("reads it through the link without logging in", async () => {
    const { url } = await shared();
    const res = await call("GET", url, undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("gets nothing once the link is turned off, and nothing for a wrong link", async () => {
    const { trip, url, event } = await shared();
    await call("PUT", `/api/trips/${trip.id}/link`, OWNER, { enabled: false });
    expect((await call("GET", url, undefined)).status).toBe(404);
    expect((await call("GET", `/api/shared/wrong-link/events/${event.id}/image`, undefined)).status).toBe(404);
  });

  it("does not see the image of an archived Event, nor one of another Trip", async () => {
    const { trip, event, url } = await shared();
    const other = await tripWithEvent();
    await upload(other.path, OWNER, await picture());
    // The other Trip's Event through this Trip's link.
    expect((await call("GET", `${url.replace(event.id, other.event.id)}`, undefined)).status).toBe(404);

    await call("PATCH", `/api/trips/${trip.id}/events/${event.id}`, OWNER, { area: "archive" });
    expect((await call("GET", url, undefined)).status).toBe(404);
  });
});

describe("prepareImage", () => {
  it("turns the picture the way its orientation says and drops the metadata", async () => {
    // 8 wide, 4 high, marked as needing a quarter turn: it is 4 wide and 8 high once turned.
    const turned = await sharp({ create: { width: 8, height: 4, channels: 3, background: "#369" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "someone" } } })
      .toBuffer();
    const result = await prepareImage(turned);

    expect(result?.contentType).toBe("image/jpeg");
    const meta = await sharp(result!.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([4, 8]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("shrinks a picture whose longest side is over 2560 pixels, and leaves a smaller one", async () => {
    const big = await prepareImage(await picture(3000, 100));
    expect((await sharp(big!.bytes).metadata()).width).toBe(2560);
    const small = await prepareImage(await picture(30, 10));
    expect((await sharp(small!.bytes).metadata()).width).toBe(30);
  });

  it("returns nothing for something that is not a picture", async () => {
    expect(await prepareImage(Buffer.from("not a picture"))).toBeUndefined();
    expect(await prepareImage(Buffer.alloc(0))).toBeUndefined();
  });
});
