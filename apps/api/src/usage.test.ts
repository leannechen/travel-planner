import { IMPORT_DAILY_ATTEMPTS, INVITE_LIMITS, LOOKUP_LIMITS, RESEND_LIMITS, UPLOAD_LIMITS, SEARCH_LIMITS, tripSchema } from "@travel-planner/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test/test-app";
import { GUEST_HEADER } from "./auth";
import { usageCounts } from "./db/schema";
import { clientAddress, pruneUsage, remainingUsage, takeUsage, UsageLimitError, type Caller } from "./usage";

let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(() => app.reset());
afterAll(() => app.stop());

const NOW = new Date("2026-10-23T09:30:15Z");
const account = (userId = crypto.randomUUID(), ip = "203.0.113.1"): Caller => ({ userId, account: true, ip });
const guest = (ip = "203.0.113.1"): Caller => ({ userId: crypto.randomUUID(), account: false, ip });

describe("usage limits", () => {
  it("counts lookups up to the user's share for the day, then refuses", async () => {
    const caller = account();
    await takeUsage(app.db, caller, "lookup", LOOKUP_LIMITS.perDay.account - 1, NOW);
    expect(await remainingUsage(app.db, caller, "lookup", NOW)).toBe(1);
    await takeUsage(app.db, caller, "lookup", 1, NOW);
    await expect(takeUsage(app.db, caller, "lookup", 1, NOW)).rejects.toEqual(new UsageLimitError("lookup", "day"));
    // A new UTC day starts again.
    const tomorrow = new Date("2026-10-24T00:00:00Z");
    expect(await remainingUsage(app.db, caller, "lookup", tomorrow)).toBe(LOOKUP_LIMITS.perDay.account);
  });

  it("gives a guest a smaller share than an account", async () => {
    expect(await remainingUsage(app.db, guest(), "lookup", NOW)).toBe(LOOKUP_LIMITS.perDay.guest);
    expect(await remainingUsage(app.db, guest(), "search", NOW)).toBe(SEARCH_LIMITS.perMinute.user);
  });

  it("counts every user of one IP address against that address's share", async () => {
    await takeUsage(app.db, account(), "lookup", LOOKUP_LIMITS.perDay.account, NOW);
    const other = account();
    await expect(takeUsage(app.db, other, "lookup", LOOKUP_LIMITS.perDay.ip - LOOKUP_LIMITS.perDay.account + 1, NOW)).rejects.toThrow(UsageLimitError);
    expect(await remainingUsage(app.db, other, "lookup", NOW)).toBe(LOOKUP_LIMITS.perDay.ip - LOOKUP_LIMITS.perDay.account);
    // Another address is not affected.
    expect(await remainingUsage(app.db, account(undefined, "203.0.113.2"), "lookup", NOW)).toBe(LOOKUP_LIMITS.perDay.account);
  });

  it("counts nothing when one of the caller's limits would go over", async () => {
    const caller = guest();
    await takeUsage(app.db, caller, "lookup", LOOKUP_LIMITS.perDay.guest - 5, NOW);
    await expect(takeUsage(app.db, caller, "lookup", 10, NOW)).rejects.toThrow(UsageLimitError);
    expect(await remainingUsage(app.db, caller, "lookup", NOW)).toBe(5);
    // The IP address's count did not take the refused lookups either.
    const [ip] = await app.db.select().from(usageCounts).where(eq(usageCounts.subject, `ip:${caller.ip}`));
    expect(ip?.count).toBe(LOOKUP_LIMITS.perDay.guest - 5);
  });

  it("limits searches per minute, and again in the next minute", async () => {
    const caller = account();
    await takeUsage(app.db, caller, "search", SEARCH_LIMITS.perMinute.user, NOW);
    await expect(takeUsage(app.db, caller, "search", 1, NOW)).rejects.toEqual(new UsageLimitError("search", "minute"));
    await takeUsage(app.db, caller, "search", 1, new Date(NOW.getTime() + 60_000));
  });

  it("does not let requests at the same time go past a limit together", async () => {
    const caller = account();
    const tries = await Promise.allSettled(Array.from({ length: SEARCH_LIMITS.perMinute.user + 10 }, () => takeUsage(app.db, caller, "search", 1, NOW)));
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(SEARCH_LIMITS.perMinute.user);
  });

  it("removes the counts of past days", async () => {
    await takeUsage(app.db, account(), "lookup", 1, new Date("2026-10-20T12:00:00Z"));
    await takeUsage(app.db, account(), "lookup", 1, NOW);
    await pruneUsage(app.db, NOW);
    expect((await app.db.select().from(usageCounts)).map((r) => r.windowStart)).toEqual([new Date("2026-10-23T00:00:00Z"), new Date("2026-10-23T00:00:00Z")]);
  });
});

describe("email limits", () => {
  it("counts invitations for the Trip across the people who may invite", async () => {
    const half = INVITE_LIMITS.perDay.trip / 2;
    await takeUsage(app.db, { ...account(), tripId: "t1" }, "invite", half, NOW);
    await takeUsage(app.db, { ...account(), tripId: "t1" }, "invite", half, NOW);
    // The Trip's share is used up, though neither person has used theirs.
    await expect(takeUsage(app.db, { ...account(), tripId: "t1" }, "invite", 1, NOW)).rejects.toEqual(new UsageLimitError("invite", "day"));
    await takeUsage(app.db, { ...account(), tripId: "t2" }, "invite", 1, NOW);
  });

  it("counts invitations for the user across Trips", async () => {
    const owner = account();
    await takeUsage(app.db, { ...owner, tripId: "t1" }, "invite", INVITE_LIMITS.perDay.user, NOW);
    await expect(takeUsage(app.db, { ...owner, tripId: "t2" }, "invite", 1, NOW)).rejects.toThrow(UsageLimitError);
  });

  it("counts invitations for the IP address across users", async () => {
    // Two people with 20 each leave 10 of the address's 50.
    await takeUsage(app.db, { ...account(), tripId: crypto.randomUUID() }, "invite", 20, NOW);
    await takeUsage(app.db, { ...account(), tripId: crypto.randomUUID() }, "invite", 20, NOW);
    await expect(takeUsage(app.db, { ...account(), tripId: crypto.randomUUID() }, "invite", 11, NOW)).rejects.toThrow(UsageLimitError);
    await takeUsage(app.db, { ...account(), tripId: crypto.randomUUID() }, "invite", 10, NOW);
  });

  it("counts the verification email per IP address across users", async () => {
    for (let i = 0; i < RESEND_LIMITS.perDay.ip / RESEND_LIMITS.perDay.user; i++) await takeUsage(app.db, account(), "resend", RESEND_LIMITS.perDay.user, NOW);
    await expect(takeUsage(app.db, account(), "resend", 1, NOW)).rejects.toEqual(new UsageLimitError("resend", "day"));
  });

  it("counts the verification email per user", async () => {
    const caller = account();
    await takeUsage(app.db, caller, "resend", RESEND_LIMITS.perDay.user, NOW);
    await expect(takeUsage(app.db, caller, "resend", 1, NOW)).rejects.toEqual(new UsageLimitError("resend", "day"));
    expect(await remainingUsage(app.db, caller, "resend", new Date("2026-10-24T00:00:00Z"))).toBe(RESEND_LIMITS.perDay.user);
  });
});

describe("upload limits", () => {
  it("limits uploads per minute and per day, a guest less than an account", async () => {
    const caller = account();
    await takeUsage(app.db, caller, "upload", UPLOAD_LIMITS.perMinute.user, NOW);
    await expect(takeUsage(app.db, caller, "upload", 1, NOW)).rejects.toEqual(new UsageLimitError("upload", "minute"));
    // The next minute starts again.
    await takeUsage(app.db, caller, "upload", 1, new Date(NOW.getTime() + 60_000));
    expect(await remainingUsage(app.db, guest(), "upload", NOW)).toBe(UPLOAD_LIMITS.perMinute.user);
    const g = guest();
    for (let i = 0; i < UPLOAD_LIMITS.perDay.guest / UPLOAD_LIMITS.perMinute.user; i++) await takeUsage(app.db, g, "upload", UPLOAD_LIMITS.perMinute.user, new Date(NOW.getTime() + i * 60_000));
    await expect(takeUsage(app.db, g, "upload", 1, new Date(NOW.getTime() + 10 * 60_000))).rejects.toEqual(new UsageLimitError("upload", "day"));
  });

  it("counts every user of one IP address against that address's share", async () => {
    await takeUsage(app.db, account(), "upload", UPLOAD_LIMITS.perMinute.user, NOW);
    await takeUsage(app.db, account(), "upload", UPLOAD_LIMITS.perMinute.user, NOW);
    await takeUsage(app.db, account(), "upload", UPLOAD_LIMITS.perMinute.user, NOW);
    await expect(takeUsage(app.db, account(), "upload", 1, NOW)).rejects.toEqual(new UsageLimitError("upload", "minute"));
  });
});

describe("clientAddress", () => {
  it("counts an IPv4 address as itself, also when written as IPv6", () => {
    expect(clientAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(clientAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("counts every IPv6 address of one /64 as one", () => {
    expect(clientAddress("2001:db8:85a3:12::1")).toBe("2001:db8:85a3:12::/64");
    expect(clientAddress("2001:0DB8:85a3:0012:ffff:1:2:3")).toBe("2001:db8:85a3:12::/64");
    expect(clientAddress("2001:db8::1%eth0")).toBe("2001:db8:0:0::/64");
    expect(clientAddress("::1")).toBe("0:0:0:0::/64");
  });
});

describe("usage limits on the API", () => {
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${app.baseUrl}${path}`, { headers });

  it("answers 429 to place searches past the per-minute share, saying to wait a minute", async () => {
    for (let i = 0; i < SEARCH_LIMITS.perMinute.user; i++) expect((await get("/api/places/search?q=kyoto")).status).toBe(200);
    const refused = await get("/api/places/search?q=kyoto");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "search_limit", window: "minute" });
  });

  it("stops a guest who keeps starting new sessions, by the IP address's share", async () => {
    const asGuest = () => ({ [GUEST_HEADER]: crypto.randomUUID() });
    for (let i = 0; i < SEARCH_LIMITS.perMinute.ip; i++) expect((await get("/api/places/search?q=nara", asGuest())).status).toBe(200);
    expect((await get("/api/places/search?q=nara", asGuest())).status).toBe(429);
  });

  it("counts only lookups that reach the provider, not cached places", async () => {
    await get("/api/places?ids=fake:nara-park");
    await get("/api/places?ids=fake:nara-park");
    const rows = await app.db.select().from(usageCounts).where(eq(usageCounts.bucket, "lookup-day"));
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
  });

  it("answers 429 to a lookup once the day's share is used, and still saves an Event, leaving its Leg to be calculated later", async () => {
    const post = (path: string, body: object, method = "POST") => fetch(`${app.baseUrl}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const trip = tripSchema.parse(await (await post("/api/trips", { title: "Kyoto", travelMode: "walk" })).json());
    const day = trip.days[0]!.id;
    const first = await (await post(`/api/trips/${trip.id}/days/${day}/events`, { title: "Kiyomizu-dera", placeId: "fake:kiyomizu-dera", startMinute: 540 })).json();
    const second = await (await post(`/api/trips/${trip.id}/days/${day}/events`, { title: "Pontocho", placeId: "fake:pontocho", startMinute: 660 })).json();
    expect((await post(`/api/trips/${trip.id}/legs`, { fromEventId: first.id, toEventId: second.id, mode: "walk" })).status).toBe(201);
    // Nara Park is cached, so choosing it needs no lookup; its travel time does.
    await get("/api/places?ids=fake:nara-park");
    const me = await (await get("/api/me")).json();
    const caller = { userId: me.id, account: true, ip: "elsewhere" };
    await takeUsage(app.db, caller, "lookup", await remainingUsage(app.db, caller, "lookup"));

    const refused = await get("/api/places?ids=fake:todai-ji");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "lookup_limit", window: "day" });
    expect((await post(`/api/trips/${trip.id}/events/${second.id}`, { placeId: "fake:nara-park" }, "PATCH")).status).toBe(200);
    const legs = await (await get(`/api/trips/${trip.id}/legs`)).json();
    expect(legs).toMatchObject([{ fromEventId: first.id, toEventId: second.id, durationMinutes: null }]);
  });

  it("limits backup imports an account starts in a day, before reading the file", async () => {
    const me = await (await get("/api/me")).json();
    await takeUsage(app.db, { userId: me.id, account: true, ip: "elsewhere" }, "import", IMPORT_DAILY_ATTEMPTS);
    const refused = await fetch(`${app.baseUrl}/api/trips/import`, { method: "POST", headers: { "content-type": "application/json" }, body: "not even json" });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "import_limit" });
  });
});
