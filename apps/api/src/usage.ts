import { IMPORT_DAILY_ATTEMPTS, INVITE_LIMITS, LOOKUP_LIMITS, RESEND_LIMITS, SEARCH_LIMITS } from "@travel-planner/shared";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { usageCounts } from "./db/schema";
import type { PlaceProvider } from "./places";
import type { RouteProvider } from "./routes";

// What is limited (plan step 33): Google place searches, other Google calls (place details, opening
// hours, photos, travel times), backup imports, and the two things that send email (plan step 44).
export type UsageKind = "search" | "lookup" | "import" | "invite" | "resend";
export type UsageWindow = "minute" | "day";

// Who a request is counted for: the user it acts as (an account or a guest session), when it has
// one, and the IP address it came from. `tripId` is the Trip a request acts on, for limits per Trip;
// give it only once the caller is known to have access to the Trip.
export type Caller = { userId?: string; account: boolean; ip: string; tripId?: string };

// Someone used their share of `kind` for the current `window`.
export class UsageLimitError extends Error {
  constructor(
    readonly kind: UsageKind,
    readonly window: UsageWindow,
  ) {
    super(`The ${kind} limit per ${window} is reached`);
  }
}

type Limit = { subject: string; bucket: string; window: UsageWindow; max: number };

function limitsOf(kind: UsageKind, caller: Caller): Limit[] {
  const user = caller.userId ? `user:${caller.userId}` : undefined;
  const ip = `ip:${caller.ip}`;
  const limits: (Limit | false)[] =
    kind === "search"
      ? [
          !!user && { subject: user, bucket: "search-minute", window: "minute", max: SEARCH_LIMITS.perMinute.user },
          { subject: ip, bucket: "search-minute", window: "minute", max: SEARCH_LIMITS.perMinute.ip },
          !!user && { subject: user, bucket: "search-day", window: "day", max: caller.account ? SEARCH_LIMITS.perDay.account : SEARCH_LIMITS.perDay.guest },
          { subject: ip, bucket: "search-day", window: "day", max: SEARCH_LIMITS.perDay.ip },
        ]
      : kind === "lookup"
        ? [
            !!user && { subject: user, bucket: "lookup-day", window: "day", max: caller.account ? LOOKUP_LIMITS.perDay.account : LOOKUP_LIMITS.perDay.guest },
            { subject: ip, bucket: "lookup-day", window: "day", max: LOOKUP_LIMITS.perDay.ip },
          ]
        : kind === "import"
          ? [!!user && { subject: user, bucket: "import-day", window: "day", max: IMPORT_DAILY_ATTEMPTS }]
          : kind === "invite"
            ? [
                !!user && { subject: user, bucket: "invite-day", window: "day", max: INVITE_LIMITS.perDay.user },
                !!caller.tripId && { subject: `trip:${caller.tripId}`, bucket: "invite-day", window: "day", max: INVITE_LIMITS.perDay.trip },
                { subject: ip, bucket: "invite-day", window: "day", max: INVITE_LIMITS.perDay.ip },
              ]
            : [
                !!user && { subject: user, bucket: "resend-day", window: "day", max: RESEND_LIMITS.perDay.user },
                { subject: ip, bucket: "resend-day", window: "day", max: RESEND_LIMITS.perDay.ip },
              ];
  return limits.filter((l): l is Limit => l !== false);
}

// The start of the minute or of the UTC day that `now` is in.
function windowStart(window: UsageWindow, now: Date): Date {
  if (window === "minute") return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Counts `n` uses of `kind` for the caller, or none at all: when any of the caller's limits would go
// over, nothing is counted and a UsageLimitError says which window was full.
export async function takeUsage(db: Db, caller: Caller, kind: UsageKind, n = 1, now = new Date()): Promise<void> {
  if (n <= 0) return;
  await db.transaction(async (tx) => {
    for (const limit of limitsOf(kind, caller)) {
      const [row] = await tx
        .insert(usageCounts)
        .values({ subject: limit.subject, bucket: limit.bucket, windowStart: windowStart(limit.window, now), count: n })
        .onConflictDoUpdate({
          target: [usageCounts.subject, usageCounts.bucket, usageCounts.windowStart],
          set: { count: sql`${usageCounts.count} + ${n}` },
          setWhere: sql`${usageCounts.count} + ${n} <= ${limit.max}`,
        })
        .returning({ count: usageCounts.count });
      // Throwing rolls back what this call already counted for the caller's other limits.
      if (!row || row.count > limit.max) throw new UsageLimitError(kind, limit.window);
    }
  });
}

// Gives back `n` uses counted earlier and not used (never below zero).
export async function giveBackUsage(db: Db, caller: Caller, kind: UsageKind, n: number, now = new Date()): Promise<void> {
  if (n <= 0) return;
  for (const limit of limitsOf(kind, caller)) {
    await db
      .update(usageCounts)
      .set({ count: sql`greatest(${usageCounts.count} - ${n}, 0)` })
      .where(and(eq(usageCounts.subject, limit.subject), eq(usageCounts.bucket, limit.bucket), eq(usageCounts.windowStart, windowStart(limit.window, now))));
  }
}

// The address a client is counted by: an IPv4 address (also when written as IPv6), or the first half
// (/64) of an IPv6 address, since one client usually has a whole /64 and can use any address in it.
export function clientAddress(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.split("%")[0]!.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// How many uses of `kind` the caller has left now: the smallest share left over all their limits.
export async function remainingUsage(db: Db, caller: Caller, kind: UsageKind, now = new Date()): Promise<number> {
  let left = Infinity;
  for (const limit of limitsOf(kind, caller)) {
    const [row] = await db
      .select({ count: usageCounts.count })
      .from(usageCounts)
      .where(and(eq(usageCounts.subject, limit.subject), eq(usageCounts.bucket, limit.bucket), eq(usageCounts.windowStart, windowStart(limit.window, now))));
    left = Math.min(left, limit.max - (row?.count ?? 0));
  }
  return Math.max(left, 0);
}

// Removes the counts of windows that ended more than a day ago.
export async function pruneUsage(db: Db, now = new Date()): Promise<void> {
  await db.delete(usageCounts).where(lt(usageCounts.windowStart, new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)));
}

type Use = (kind: "search" | "lookup") => Promise<void>;

// The place provider with every call to it counted first; a call over the limit throws a
// UsageLimitError and never reaches the provider. `findId` asks for ids only, which Google does not
// charge for, and is used by AI generation alone, which has its own limits.
export function meteredPlaces(provider: PlaceProvider, use: Use): PlaceProvider {
  return {
    name: provider.name,
    findId: (query) => provider.findId(query),
    async search(query) {
      await use("search");
      return provider.search(query);
    },
    async get(id) {
      await use("lookup");
      return provider.get(id);
    },
    async getOpeningHours(id) {
      await use("lookup");
      return provider.getOpeningHours(id);
    },
    async getPhoto(id) {
      await use("lookup");
      return provider.getPhoto(id);
    },
    async getPhotoUri(ref) {
      await use("lookup");
      return provider.getPhotoUri(ref);
    },
  };
}

export function meteredRoutes(routes: RouteProvider, use: Use): RouteProvider {
  return {
    async estimate(...args) {
      await use("lookup");
      return routes.estimate(...args);
    },
  };
}
