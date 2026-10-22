import { eventSchema, tripSchema } from "@travel-planner/shared";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test/test-app";

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

function call(method: string, path: string, token: string, body?: unknown, type = "application/json") {
  return fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": type }) },
    body: body === undefined ? undefined : body instanceof Buffer ? (body as BodyInit) : JSON.stringify(body),
  });
}

async function ownerTrip(title = "Kyoto & Osaka") {
  return tripSchema.parse(await (await call("POST", "/api/trips", OWNER, { title })).json());
}

// Mei becomes an Editor of the Trip.
async function addEditor(tripId: string) {
  const res = await call("POST", `/api/trips/${tripId}/invitations`, OWNER, { email: "mei@example.com" });
  const { token } = (await res.json()) as { token: string };
  expect((await call("POST", `/api/invitations/${token}/accept`, MEI)).status).toBe(200);
}

describe("renaming a Trip", () => {
  it("changes the title for the Owner and keeps the rest", async () => {
    const trip = await ownerTrip();
    const res = await call("PATCH", `/api/trips/${trip.id}`, OWNER, { title: "Japan 2026" });
    expect(await res.json()).toEqual({ title: "Japan 2026", startDate: null });
    const listed = tripSchema.array().parse(await (await call("GET", "/api/trips", OWNER)).json());
    expect(listed.find((t) => t.id === trip.id)?.title).toBe("Japan 2026");
  });

  it("refuses an empty title, and an Editor, who gets 404 as for a Trip that is not theirs", async () => {
    const trip = await ownerTrip();
    await addEditor(trip.id);
    expect((await call("PATCH", `/api/trips/${trip.id}`, OWNER, { title: "   " })).status).toBe(400);
    expect((await call("PATCH", `/api/trips/${trip.id}`, MEI, { title: "Mine now" })).status).toBe(404);
    expect((await call("PATCH", `/api/trips/${trip.id}`, MEI, { startDate: "2026-11-03" })).status).toBe(200);
  });
});

describe("deleting a Trip", () => {
  it("deletes the Trip with its Events and the image files, and the Editor loses it too", async () => {
    const trip = await ownerTrip();
    await addEditor(trip.id);
    const other = await ownerTrip("Taipei");
    const event = eventSchema.parse(await (await call("POST", `/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, OWNER, { title: "Fushimi Inari" })).json());
    const picture = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#d33" } }).png().toBuffer();
    expect((await call("PUT", `/api/trips/${trip.id}/events/${event.id}/image`, OWNER, picture, "image/png")).status).toBe(200);
    expect(app.images.keys()).toHaveLength(1);

    expect((await call("DELETE", `/api/trips/${trip.id}`, OWNER)).status).toBe(204);

    expect(app.images.keys()).toEqual([]);
    const mine = tripSchema.array().parse(await (await call("GET", "/api/trips", OWNER)).json());
    expect(mine.map((t) => t.id)).toEqual([other.id]);
    expect(tripSchema.array().parse(await (await call("GET", "/api/trips", MEI)).json())).toEqual([]);
    expect((await call("DELETE", `/api/trips/${trip.id}`, OWNER)).status).toBe(404);
  });

  it("is for the Owner only: an Editor and a stranger get 404 and the Trip stays", async () => {
    const trip = await ownerTrip();
    await addEditor(trip.id);
    expect((await call("DELETE", `/api/trips/${trip.id}`, MEI)).status).toBe(404);
    expect((await call("DELETE", `/api/trips/${trip.id}`, "fake:stranger@example.com")).status).toBe(404);
    expect(tripSchema.array().parse(await (await call("GET", "/api/trips", OWNER)).json())).toHaveLength(1);
  });

  it("leaves no file behind when it runs while an image is being uploaded", async () => {
    const picture = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#d33" } }).png().toBuffer();
    for (let round = 0; round < 5; round++) {
      const trip = await ownerTrip(`Round ${round}`);
      const event = eventSchema.parse(await (await call("POST", `/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, OWNER, { title: "Fushimi Inari" })).json());
      await Promise.all([
        call("PUT", `/api/trips/${trip.id}/events/${event.id}/image`, OWNER, picture, "image/png"),
        call("DELETE", `/api/trips/${trip.id}`, OWNER),
      ]);
      expect(app.images.keys(), `round ${round}`).toEqual([]);
    }
  });
});
