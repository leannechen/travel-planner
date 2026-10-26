import { tripSchema } from "@travel-planner/shared";
import { eq, isNotNull, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp, testToken } from "../test/test-app";
import { users } from "./db/schema";
import { GUEST_RETENTION_DAYS, pruneGuests } from "./guests";

let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(() => app.reset());
afterAll(() => app.stop());

const DAY = 24 * 60 * 60 * 1000;
const account = { authorization: `Bearer ${testToken("auth0|lena")}` };
const guest = () => ({ "x-guest-id": crypto.randomUUID() });
type Headers = Record<string, string>;

const trips = async (headers: Headers) => z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`, { headers })).json());
const openSample = (headers: Headers) => fetch(`${app.baseUrl}/api/sample-trip`, { method: "POST", headers });
// Pretends the guest was last seen this long ago.
const seenAgo = (token: string, ms: number) =>
  app.db.update(users).set({ lastSeenAt: new Date(Date.now() - ms) }).where(eq(users.guestToken, token));
const count = async () => Number((await app.db.execute(sql`select count(*) as n from users`)).rows[0]!.n);

describe("removing guests nobody has seen for a month", () => {
  it("removes a stale guest with their Trips and keeps a recent guest and an account", async () => {
    const stale = guest();
    const recent = guest();
    await openSample(stale);
    await openSample(recent);
    await openSample(account);
    await seenAgo(stale["x-guest-id"], (GUEST_RETENTION_DAYS + 1) * DAY);
    await seenAgo(recent["x-guest-id"], (GUEST_RETENTION_DAYS - 1) * DAY);
    // An account's lastSeenAt is never touched, so an old account looks stale; only guests are removed.
    await app.db.update(users).set({ lastSeenAt: new Date(Date.now() - (GUEST_RETENTION_DAYS + 1) * DAY) }).where(isNotNull(users.auth0Sub));

    expect(await pruneGuests(app.db, app.images)).toBe(1);

    expect(await count()).toBe(2);
    expect(await trips(recent)).toHaveLength(1);
    expect(await trips(account)).toHaveLength(1);
    // A guest who comes back after being removed starts again, with nothing.
    expect(await trips(stale)).toHaveLength(0);
  });

  it("removes the uploaded images of the guest's Trips too", async () => {
    const stale = guest();
    await openSample(stale);
    const [trip] = await trips(stale);
    const event = trip!.days[0]!.events[0]!;
    const picture = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#d33" } }).png().toBuffer();
    const put = await fetch(`${app.baseUrl}/api/trips/${trip!.id}/events/${event.id}/image`, {
      method: "PUT",
      headers: { ...stale, "content-type": "image/png" },
      body: picture as BodyInit,
    });
    expect(put.status).toBe(200);
    expect(app.images.keys()).toHaveLength(1);

    await seenAgo(stale["x-guest-id"], (GUEST_RETENTION_DAYS + 1) * DAY);
    await pruneGuests(app.db, app.images);
    expect(app.images.keys()).toHaveLength(0);
    expect(await count()).toBe(0);
  });

  it("counts a request as being seen, at most once an hour", async () => {
    const headers = guest();
    const token = headers["x-guest-id"];
    await trips(headers);
    await seenAgo(token, 3 * DAY);
    await trips(headers);
    const [row] = await app.db.select({ seen: users.lastSeenAt }).from(users).where(eq(users.guestToken, token));
    expect(Date.now() - row!.seen.getTime()).toBeLessThan(60 * 1000);
    expect(await pruneGuests(app.db, app.images)).toBe(0);
  });

  it("does not mark a guest as seen again within the hour", async () => {
    const headers = guest();
    const token = headers["x-guest-id"];
    await trips(headers);
    await seenAgo(token, 30 * 60 * 1000);
    const [before] = await app.db.select({ seen: users.lastSeenAt }).from(users).where(eq(users.guestToken, token));
    await trips(headers);
    const [after] = await app.db.select({ seen: users.lastSeenAt }).from(users).where(eq(users.guestToken, token));
    expect(after!.seen).toEqual(before!.seen);
  });
});
