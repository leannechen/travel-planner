import { backupSchema, eventSchema, tripSchema, type Backup } from "@travel-planner/shared";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test/test-app";
import { GUEST_HEADER } from "./auth";
import { users } from "./db/schema";
import { remainingUsage, takeUsage } from "./usage";

let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(() => app.reset());
afterAll(() => app.stop());

const OWNER = "fake:lena@example.com";
const STRANGER = "fake:stranger@example.com";

function call(method: string, path: string, token: string, body?: unknown, raw?: BodyInit) {
  return fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}
const json = async (res: Response) => res.json();

// A Trip with a Day of two Events (the first with a picture, a Todo and a Leg), a Backlog Event, a
// Trip Todo and two Notes, one pinned.
async function fullTrip() {
  const trip = tripSchema.parse(await json(await call("POST", "/api/trips", OWNER, { title: "Kyoto", startDate: "2026-11-03", travelMode: "walk" })));
  const day = trip.days[0]!;
  const add = async (title: string, extra: object = {}) =>
    eventSchema.parse(await json(await call("POST", `/api/trips/${trip.id}/days/${day.id}/events`, OWNER, { title, ...extra })));
  const first = await add("Kiyomizu-dera", { placeId: "fake:kiyomizu-dera", startMinute: 540 });
  const second = await add("Pontocho", { kind: "meal", placeId: "fake:pontocho", startMinute: 660 });
  const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#d33" } }).png().toBuffer();
  await fetch(`${app.baseUrl}/api/trips/${trip.id}/events/${first.id}/image`, { method: "PUT", headers: { authorization: `Bearer ${OWNER}`, "content-type": "image/png" }, body: png as BodyInit });
  await call("POST", `/api/trips/${trip.id}/todos`, OWNER, { text: "Bring coins", eventId: first.id });
  await call("POST", `/api/trips/${trip.id}/todos`, OWNER, { text: "Buy a rail pass" });
  await call("POST", `/api/trips/${trip.id}/legs`, OWNER, { fromEventId: first.id, toEventId: second.id, mode: "walk" });
  await call("POST", `/api/trips/${trip.id}/events`.replace("/events", "/backlog/events"), OWNER, { title: "Tenryu-ji" });
  await call("POST", `/api/trips/${trip.id}/notes`, OWNER, { body: "first note" });
  const pinned = await json(await call("POST", `/api/trips/${trip.id}/notes`, OWNER, { body: "pinned note" }));
  await call("PATCH", `/api/trips/${trip.id}/notes/${pinned.id}`, OWNER, { pinned: true });
  return { trip, first, second };
}

const backupOf = async (tripId: string, token = OWNER) => backupSchema.parse(await json(await call("GET", `/api/trips/${tripId}/backup`, token)));
const listTrips = async (token = OWNER) => tripSchema.array().parse(await json(await call("GET", "/api/trips", token)));

describe("exporting a backup", () => {
  it("holds the Trip with its Todos, Legs, Notes and uploaded image", async () => {
    const { trip } = await fullTrip();
    const backup = await backupOf(trip.id);
    expect(backup.trip).toMatchObject({ title: "Kyoto", startDate: "2026-11-03", travelMode: "walk" });
    const [first, second] = backup.trip.days[0]!;
    expect(first).toMatchObject({ title: "Kiyomizu-dera", placeId: "fake:kiyomizu-dera", legToNext: "walk", todos: [{ text: "Bring coins", done: false }] });
    expect(first!.image?.contentType).toBe("image/png");
    expect(second).toMatchObject({ title: "Pontocho", kind: "meal", legToNext: null, image: null });
    expect(backup.trip.backlog.map((e) => e.title)).toEqual(["Tenryu-ji"]);
    expect(backup.trip.todos).toEqual([{ text: "Buy a rail pass", done: false }]);
    expect(backup.trip.notes).toEqual([{ body: "pinned note", pinned: true }, { body: "first note", pinned: false }]);
  });

  it("is refused for a Trip that is not the user's", async () => {
    const { trip } = await fullTrip();
    expect((await call("GET", `/api/trips/${trip.id}/backup`, STRANGER)).status).toBe(404);
  });
});

describe("importing a backup", () => {
  it("makes a new Trip like the exported one and leaves the original alone", async () => {
    const { trip } = await fullTrip();
    const backup = await backupOf(trip.id);
    const res = await call("POST", "/api/trips/import", OWNER, backup);
    expect(res.status).toBe(201);
    const copy = tripSchema.parse(await json(res));
    expect(copy.id).not.toBe(trip.id);
    expect(await listTrips()).toHaveLength(2);

    // The copy exports to the same backup.
    expect(await backupOf(copy.id)).toEqual(backup);

    // The copy has its own image file, so the original keeps its picture when the copy goes.
    const original = (await listTrips()).find((t) => t.id === trip.id)!;
    expect(copy.days[0]!.events[0]!.imageId).not.toBeNull();
    expect(copy.days[0]!.events[0]!.imageId).not.toBe(original.days[0]!.events[0]!.imageId);
    expect(app.images.keys()).toHaveLength(2);
    expect((await call("DELETE", `/api/trips/${copy.id}`, OWNER)).status).toBe(204);
    expect(app.images.keys()).toHaveLength(1);
    expect(await backupOf(trip.id)).toEqual(backup);
  });

  it("works for another user, who becomes the owner", async () => {
    const { trip } = await fullTrip();
    const backup = await backupOf(trip.id);
    const copy = tripSchema.parse(await json(await call("POST", "/api/trips/import", STRANGER, backup)));
    expect(copy.role).toBe("owner");
    expect(await listTrips(STRANGER)).toHaveLength(1);
  });

  it("refuses a file that is not a backup, and writes nothing", async () => {
    for (const body of [{ title: "Kyoto" }, { format: "travel-planner-backup", version: 2, trip: {} }, { format: "travel-planner-backup", version: 1, trip: { title: "" } }]) {
      const res = await call("POST", "/api/trips/import", OWNER, body);
      expect(res.status).toBe(400);
      expect(await json(res)).toMatchObject({ code: "invalid_backup" });
    }
    const text = await call("POST", "/api/trips/import", OWNER, undefined, "not json {");
    expect(text.status).toBe(400);
    expect(await listTrips()).toEqual([]);
  });

  it("refuses an image that is not a picture, and writes nothing", async () => {
    const { trip } = await fullTrip();
    const backup: Backup = structuredClone(await backupOf(trip.id));
    backup.trip.days[0]![0]!.image = { contentType: "image/png", data: Buffer.from("<svg/>").toString("base64") };
    const res = await call("POST", "/api/trips/import", OWNER, backup);
    expect(res.status).toBe(422);
    expect(await json(res)).toMatchObject({ code: "invalid_backup" });
    expect(await listTrips()).toHaveLength(1);
    expect(app.images.keys()).toHaveLength(1);
  });

  it("is for accounts: a guest is asked to log in, and nothing is written", async () => {
    const { trip } = await fullTrip();
    const backup = await backupOf(trip.id);
    const guestId = crypto.randomUUID();
    const res = await fetch(`${app.baseUrl}/api/trips/import`, { method: "POST", headers: { [GUEST_HEADER]: guestId, "content-type": "application/json" }, body: JSON.stringify(backup) });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ code: "login_required" });
    const guestTrips = await fetch(`${app.baseUrl}/api/trips`, { headers: { [GUEST_HEADER]: guestId } });
    expect(await json(guestTrips)).toEqual([]);
  });

  it("is refused whole, saying how many lookups it needs, when more are needed than are left today", async () => {
    const { trip } = await fullTrip();
    const backup: Backup = structuredClone(await backupOf(trip.id));
    // Two places that are not cached, and the walk between the first two Events.
    backup.trip.backlog.push({ ...backup.trip.backlog[0]!, title: "Nara Park", placeId: "fake:nara-park" }, { ...backup.trip.backlog[0]!, title: "Todai-ji", placeId: "fake:todai-ji" });
    const [owner] = await app.db.select({ id: users.id }).from(users).where(eq(users.auth0Sub, "lena@example.com"));
    const caller = { userId: owner!.id, account: true, ip: "elsewhere" };
    await takeUsage(app.db, caller, "lookup", (await remainingUsage(app.db, caller, "lookup")) - 2);
    const res = await call("POST", "/api/trips/import", OWNER, backup);
    expect(res.status).toBe(429);
    expect(await json(res)).toMatchObject({ code: "lookup_limit", needed: 3, remaining: 2 });
    expect(await listTrips()).toHaveLength(1);
  });

  it("is written whole with exactly the lookups it needs, a place the provider does not know too, and gives back what it did not use", async () => {
    const { trip } = await fullTrip();
    const backup: Backup = structuredClone(await backupOf(trip.id));
    // Not cached and not known: looked up for the Trip and again for the Leg that ends there.
    backup.trip.days[0]![1]!.placeId = "fake:no-such-place";
    const [owner] = await app.db.select({ id: users.id }).from(users).where(eq(users.auth0Sub, "lena@example.com"));
    const caller = { userId: owner!.id, account: true, ip: "elsewhere" };
    await takeUsage(app.db, caller, "lookup", (await remainingUsage(app.db, caller, "lookup")) - 3);
    const res = await call("POST", "/api/trips/import", OWNER, backup);
    expect(res.status).toBe(201);
    const copy = tripSchema.parse(await json(res));
    expect(copy.legs).toMatchObject([{ durationMinutes: null }]);
    expect(await remainingUsage(app.db, caller, "lookup")).toBe(1);
  });
});
