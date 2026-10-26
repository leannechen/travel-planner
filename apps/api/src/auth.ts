import { and, eq, sql } from "drizzle-orm";
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { Db } from "./db/client";
import { eventImages, todos, trips, users } from "./db/schema";

// What the API needs from a valid access token: who it is for.
// `email` and `emailVerified` come from custom claims that an Auth0 Action adds to the access token
// (see the plan, step 20); without them the API asks Auth0's /userinfo, and when that fails both are left out.
export type Identity = { sub: string; email?: string; emailVerified?: boolean };

// Checks an access token and says who it belongs to; rejects when the token is not valid. Auth0 is
// behind this (ADR 0006); a fake stands in for it in tests and local development.
export interface TokenVerifier {
  verify(token: string): Promise<Identity>;
}

// The token itself is not acceptable (a 401). Anything else that goes wrong while checking it, such as
// the tenant's keys not being reachable, is not the user's doing and stays an ordinary error (5xx).
export class TokenRejected extends Error {}

const TOKEN_ERROR_CODES = new Set([
  "ERR_JWT_EXPIRED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWT_INVALID",
  "ERR_JWS_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JWKS_MULTIPLE_MATCHING_KEYS",
  "ERR_JOSE_ALG_NOT_ALLOWED",
]);

export const GUEST_HEADER = "x-guest-id";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      // The `users` row the request acts as: an account, or a guest session.
      userId: string;
      // Set when the request carries a valid account token (not for a guest).
      accountId?: string;
      // From the account's token: the Auth0 subject, and the email address with whether it is verified.
      sub?: string;
      email?: string;
      emailVerified?: boolean;
    }
  }
}

export type AuthSettings = { domain: string; audience: string };

export function authSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): AuthSettings | undefined {
  const domain = env.AUTH0_DOMAIN?.trim();
  const audience = env.AUTH0_AUDIENCE?.trim();
  if (!domain && !audience) return undefined;
  if (!domain || !audience) throw new Error("AUTH0_DOMAIN and AUTH0_AUDIENCE must be set together");
  return { domain, audience };
}

// Accepts the access tokens Auth0 issues for this API: a signature from the tenant's keys, the
// tenant as issuer, this API as audience, not expired. `keys` is the tenant's JWKS; tests pass their own.
export function jwtVerifier(
  { domain, audience }: AuthSettings,
  keys?: JWTVerifyGetKey,
  fetchFn: typeof fetch = fetch,
): TokenVerifier {
  const issuer = `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`;
  // Auth0 only allows namespaced custom claims: the audience plus the claim name.
  const claimNamespace = `${audience.replace(/\/$/, "")}/`;
  // Without the Action's claims, Auth0's /userinfo gives the same answer for the token. Asked once
  // per token for a few minutes, and a failure just leaves the email out.
  const userinfo = new Map<string, { at: number; email?: string; emailVerified?: boolean }>();
  const fromUserinfo = async (token: string) => {
    const cached = userinfo.get(token);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached;
    let found: { at: number; email?: string; emailVerified?: boolean } = { at: Date.now() };
    try {
      const res = await fetchFn(`${issuer}userinfo`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const body = (await res.json()) as { email?: unknown; email_verified?: unknown };
        found = {
          at: found.at,
          ...(typeof body.email === "string" && body.email ? { email: body.email.toLowerCase() } : {}),
          ...(typeof body.email_verified === "boolean" ? { emailVerified: body.email_verified } : {}),
        };
      }
    } catch {
      // Not reachable: no email this time.
    }
    if (userinfo.size >= 500) userinfo.clear();
    userinfo.set(token, found);
    return found;
  };
  const jwks = keys ?? createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));
  return {
    async verify(token) {
      // Auth0 signs access tokens with RS256; refusing other algorithms rules out "none" and
      // key-confusion tricks.
      let payload;
      try {
        ({ payload } = await jwtVerify(token, jwks, { issuer, audience, algorithms: ["RS256"] }));
      } catch (err) {
        if (err instanceof errors.JOSEError && TOKEN_ERROR_CODES.has(err.code)) throw new TokenRejected(err.message);
        throw err;
      }
      if (!payload.sub) throw new TokenRejected("The token has no subject");
      const email = payload[`${claimNamespace}email`];
      const emailVerified = payload[`${claimNamespace}email_verified`];
      if (typeof email !== "string" || !email) {
        const { email: found, emailVerified: foundVerified } = await fromUserinfo(token);
        return { sub: payload.sub, ...(found ? { email: found } : {}), ...(foundVerified !== undefined ? { emailVerified: foundVerified } : {}) };
      }
      return {
        sub: payload.sub,
        email: email.toLowerCase(),
        ...(typeof emailVerified === "boolean" ? { emailVerified } : {}),
      };
    },
  };
}

// Development and tests: the token "fake:<sub>" belongs to <sub>, and when that looks like an email
// address it is also the account's verified email; "fake-unverified:<email>" has an unverified one.
// Only with AUTH_FAKE=1 and no Auth0 settings.
export function fakeTokenVerifier(): TokenVerifier {
  return {
    async verify(token) {
      const match = /^(fake|fake-unverified):(.+)$/.exec(token);
      if (!match) throw new TokenRejected("Not a fake token");
      const sub = match[2]!;
      if (!sub.includes("@")) return { sub };
      return { sub, email: sub.toLowerCase(), emailVerified: match[1] === "fake" };
    },
  };
}

export function verifierFromEnv(env: NodeJS.ProcessEnv = process.env): TokenVerifier {
  // Copying the development .env to a deployment must fail loudly, not be ignored in silence.
  if (env.AUTH_FAKE && env.NODE_ENV === "production") throw new Error("AUTH_FAKE is for development only; remove it from the production environment");
  const settings = authSettingsFromEnv(env);
  if (settings) return jwtVerifier(settings);
  // Without a tenant anyone could act as anyone, so it takes an explicit choice (development).
  // The production check is repeated on purpose, so this line stays safe if the one above changes.
  if (env.AUTH_FAKE === "1" && env.NODE_ENV !== "production") return fakeTokenVerifier();
  throw new Error("Set AUTH0_DOMAIN and AUTH0_AUDIENCE (or AUTH_FAKE=1 for development without a tenant)");
}

// The user row of an account, created on its first request.
// The email address is kept up to date from the token, so the Share dialog can name people.
// Pass it only once verified: it is shown to others as who this person is.
export async function findOrCreateAccount(db: Db, sub: string, email?: string): Promise<string> {
  const [found] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.auth0Sub, sub));
  if (found) {
    if (email && found.email !== email) await db.update(users).set({ email }).where(eq(users.id, found.id));
    return found.id;
  }
  // Two first requests can race; the loser finds the winner's row.
  const [created] = await db.insert(users).values({ auth0Sub: sub, email }).onConflictDoNothing().returning({ id: users.id });
  if (created) return created.id;
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.auth0Sub, sub));
  return row!.id;
}

// The guest's id, made on the first request. A request marks the guest as seen, at most once an hour.
async function findOrCreateGuest(db: Db, token: string): Promise<string> {
  const [touched] = await db
    .update(users)
    .set({ lastSeenAt: sql`now()` })
    .where(and(eq(users.guestToken, token), sql`${users.lastSeenAt} < now() - interval '1 hour'`))
    .returning({ id: users.id });
  if (touched) return touched.id;
  const [found] = await db.select({ id: users.id }).from(users).where(eq(users.guestToken, token));
  if (found) return found.id;
  const [created] = await db.insert(users).values({ guestToken: token }).onConflictDoNothing().returning({ id: users.id });
  if (created) return created.id;
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.guestToken, token));
  return row!.id;
}

const guestTokenSchema = z.uuid();

function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  const match = header && /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

export type Caller =
  | { ok: true; userId: string; accountId?: string; sub?: string; email?: string; emailVerified?: boolean }
  | { ok: false; status: 401; error: string; code: "invalid_token" | "no_session" };

// Works out who a request acts as. A bearer token wins: a bad or expired one is a 401 (never
// quietly a guest), which is how the page learns that the session ended. Without a token, the
// guest id the browser keeps stands for an anonymous user. Anything else is a 401.
export async function resolveCaller(db: Db, verifier: TokenVerifier, token: string | undefined, guestId: string | undefined): Promise<Caller> {
  if (token) {
    let identity: Identity;
    try {
      identity = await verifier.verify(token);
    } catch (err) {
      if (!(err instanceof TokenRejected)) throw err;
      return { ok: false, status: 401, error: "Your session is not valid", code: "invalid_token" };
    }
    const userId = await findOrCreateAccount(db, identity.sub, identity.emailVerified === true ? identity.email : undefined);
    return { ok: true, userId, accountId: userId, sub: identity.sub, email: identity.email, emailVerified: identity.emailVerified };
  }
  const guest = guestTokenSchema.safeParse(guestId);
  if (guest.success) return { ok: true, userId: await findOrCreateGuest(db, guest.data) };
  return { ok: false, status: 401, error: "Log in or start a guest session first", code: "no_session" };
}

export function authenticate(db: Db, verifier: TokenVerifier) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const caller = await resolveCaller(db, verifier, bearerToken(req), req.header(GUEST_HEADER));
      if (!caller.ok) {
        res.status(caller.status).json({ error: caller.error, code: caller.code });
        return;
      }
      res.locals.userId = caller.userId;
      if (caller.accountId) {
        res.locals.accountId = caller.accountId;
        res.locals.sub = caller.sub;
        res.locals.email = caller.email;
        res.locals.emailVerified = caller.emailVerified;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Moves the guest session's Trips to the account and removes the guest. Nothing the account already
// has is touched: Trips only change owner. Running it again finds no guest and does nothing.
// The guest's user id and the moved Trips' ids are returned, so connections the guest still has open
// to those Trips can be ended; `guestId` is undefined when nothing was merged.
export async function mergeGuest(db: Db, accountId: string, guestToken: string): Promise<{ guestId?: string; tripIds: string[] }> {
  return db.transaction(async (tx) => {
    const [guest] = await tx.select({ id: users.id }).from(users).where(eq(users.guestToken, guestToken)).for("update");
    if (!guest || guest.id === accountId) return { tripIds: [] };
    // An account has one copy of a sample Trip: the guest's copy of one the account already has
    // stays as an ordinary Trip.
    await tx
      .update(trips)
      .set({ sampleOf: null })
      .where(and(eq(trips.ownerId, guest.id), sql`${trips.sampleOf} in (select "sampleOf" from trips where "ownerId" = ${accountId})`));
    const moved = await tx.update(trips).set({ ownerId: accountId }).where(eq(trips.ownerId, guest.id)).returning({ id: trips.id });
    // Todos remember who added them; the guest's go with the account.
    await tx.update(todos).set({ createdBy: accountId }).where(eq(todos.createdBy, guest.id));
    // So do their uploaded images: the rows would otherwise go with the guest, leaving the files.
    await tx.update(eventImages).set({ createdBy: accountId }).where(eq(eventImages.createdBy, guest.id));
    await tx.delete(users).where(eq(users.id, guest.id));
    return { guestId: guest.id, tripIds: moved.map((trip) => trip.id) };
  });
}
