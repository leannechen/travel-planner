import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { Db } from "./db/client";
import { todos, trips, users } from "./db/schema";

// What the API needs from a valid access token: who it is for.
export type Identity = { sub: string };

// Checks an access token and says who it belongs to; rejects when the token is not valid. Auth0 is
// behind this (ADR 0006); a fake stands in for it in tests and local development.
export interface TokenVerifier {
  verify(token: string): Promise<Identity>;
}

export const GUEST_HEADER = "x-guest-id";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      // The `users` row the request acts as: an account, or a guest session.
      userId: string;
      // Set when the request carries a valid account token (not for a guest).
      accountId?: string;
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
export function jwtVerifier({ domain, audience }: AuthSettings, keys?: JWTVerifyGetKey): TokenVerifier {
  const issuer = `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`;
  const jwks = keys ?? createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));
  return {
    async verify(token) {
      // Auth0 signs access tokens with RS256; refusing other algorithms rules out "none" and
      // key-confusion tricks.
      const { payload } = await jwtVerify(token, jwks, { issuer, audience, algorithms: ["RS256"] });
      if (!payload.sub) throw new Error("The token has no subject");
      return { sub: payload.sub };
    },
  };
}

// Development and tests: the token "fake:<sub>" belongs to <sub>. Never used when Auth0 is configured.
export function fakeTokenVerifier(): TokenVerifier {
  return {
    async verify(token) {
      const match = /^fake:(.+)$/.exec(token);
      if (!match) throw new Error("Not a fake token");
      return { sub: match[1]! };
    },
  };
}

export function verifierFromEnv(env: NodeJS.ProcessEnv = process.env): TokenVerifier {
  const settings = authSettingsFromEnv(env);
  if (settings) return jwtVerifier(settings);
  // Without a tenant anyone could sign in as anyone, so this is only for development.
  if (env.NODE_ENV === "production") throw new Error("AUTH0_DOMAIN and AUTH0_AUDIENCE are required in production");
  return fakeTokenVerifier();
}

// The user row of an account, created on its first request.
export async function findOrCreateAccount(db: Db, sub: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ auth0Sub: sub })
    // A no-op update, so the row comes back whether it was new or not.
    .onConflictDoUpdate({ target: users.auth0Sub, set: { auth0Sub: sub } })
    .returning({ id: users.id });
  return row!.id;
}

async function findOrCreateGuest(db: Db, token: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ guestToken: token })
    .onConflictDoUpdate({ target: users.guestToken, set: { guestToken: token } })
    .returning({ id: users.id });
  return row!.id;
}

const guestTokenSchema = z.uuid();

function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  const match = header && /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

// Works out who a request acts as. A bearer token wins: a bad or expired one is a 401 (never
// quietly a guest), which is how the page learns that the session ended. Without a token, the
// guest id the browser keeps stands for an anonymous user. Anything else is a 401.
export function authenticate(db: Db, verifier: TokenVerifier) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = bearerToken(req);
      if (token) {
        let identity: Identity;
        try {
          identity = await verifier.verify(token);
        } catch {
          res.status(401).json({ error: "Your session is not valid", code: "invalid_token" });
          return;
        }
        res.locals.userId = res.locals.accountId = await findOrCreateAccount(db, identity.sub);
        next();
        return;
      }
      const guest = guestTokenSchema.safeParse(req.header(GUEST_HEADER));
      if (guest.success) {
        res.locals.userId = await findOrCreateGuest(db, guest.data);
        next();
        return;
      }
      res.status(401).json({ error: "Log in or start a guest session first", code: "no_session" });
    } catch (err) {
      next(err);
    }
  };
}

// Moves the guest session's Trips to the account and removes the guest. Nothing the account already
// has is touched: Trips only change owner. Running it again finds no guest and does nothing.
export async function mergeGuest(db: Db, accountId: string, guestToken: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [guest] = await tx.select({ id: users.id }).from(users).where(eq(users.guestToken, guestToken)).for("update");
    if (!guest || guest.id === accountId) return 0;
    const moved = await tx.update(trips).set({ ownerId: accountId }).where(eq(trips.ownerId, guest.id)).returning({ id: trips.id });
    // Todos remember who added them; the guest's go with the account.
    await tx.update(todos).set({ createdBy: accountId }).where(eq(todos.createdBy, guest.id));
    await tx.delete(users).where(eq(users.id, guest.id));
    return moved.length;
  });
}
