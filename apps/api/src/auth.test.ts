import { eq } from "drizzle-orm";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { tripSchema } from "@travel-planner/shared";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp, testToken } from "../test/test-app";
import { authSettingsFromEnv, jwtVerifier, mergeGuest, TokenRejected, verifierFromEnv } from "./auth";
import { trips, users } from "./db/schema";

const settings = { domain: "tenant.example.auth0.com", audience: "https://api.travel-planner.example" };
const ISSUER = `https://${settings.domain}/`;

async function makeKeys(kid = "key-1") {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }), kid };
}

describe("access token check", () => {
  let keys: Awaited<ReturnType<typeof makeKeys>>;
  let verifier: ReturnType<typeof jwtVerifier>;

  beforeAll(async () => {
    keys = await makeKeys();
    verifier = jwtVerifier(settings, keys.jwks, async () => new Response(null, { status: 401 }));
  });

  const sign = (claims: { iss?: string; aud?: string; sub?: string | null; exp?: string | number; extra?: Record<string, unknown> } = {}, key = keys.privateKey, kid = keys.kid) => {
    const jwt = new SignJWT(claims.extra ?? {}).setProtectedHeader({ alg: "RS256", kid }).setIssuer(claims.iss ?? ISSUER).setAudience(claims.aud ?? settings.audience).setIssuedAt();
    if (claims.sub !== null) jwt.setSubject(claims.sub ?? "auth0|abc");
    return jwt.setExpirationTime(claims.exp ?? "5m").sign(key);
  };

  it("accepts a token from the tenant for this API and returns its subject", async () => {
    expect(await verifier.verify(await sign())).toEqual({ sub: "auth0|abc" });
  });

  it("reads the email address and its verification from the namespaced claims", async () => {
    const extra = { [`${settings.audience}/email`]: "Mei@Example.com", [`${settings.audience}/email_verified`]: false };
    expect(await verifier.verify(await sign({ extra }))).toEqual({ sub: "auth0|abc", email: "mei@example.com", emailVerified: false });
  });

  it("asks Auth0's userinfo for the email when the token has no claims, once per token", async () => {
    const calls: string[] = [];
    const asking = jwtVerifier(settings, keys.jwks, async (url) => {
      calls.push(String(url));
      return Response.json({ email: "Mei@Example.com", email_verified: true });
    });
    const token = await sign({});
    const expected = { sub: "auth0|abc", email: "mei@example.com", emailVerified: true };
    expect(await asking.verify(token)).toEqual(expected);
    expect(await asking.verify(token)).toEqual(expected);
    expect(calls).toEqual([`https://${settings.domain}/userinfo`]);
  });

  it("does not take an email from a claim that is not namespaced", async () => {
    expect(await verifier.verify(await sign({ extra: { email: "mei@example.com", email_verified: true } }))).toEqual({ sub: "auth0|abc" });
  });

  it("rejects a token for another audience", async () => {
    await expect(verifier.verify(await sign({ aud: "https://other-api.example" }))).rejects.toThrow();
  });

  it("rejects a token from another issuer", async () => {
    await expect(verifier.verify(await sign({ iss: "https://evil.example.com/" }))).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    await expect(verifier.verify(await sign({ exp: Math.floor(Date.now() / 1000) - 60 }))).rejects.toThrow();
  });

  it("rejects a token signed with a key the tenant does not publish", async () => {
    const other = await makeKeys();
    await expect(verifier.verify(await sign({}, other.privateKey))).rejects.toThrow();
  });

  it("rejects a token without a subject", async () => {
    await expect(verifier.verify(await sign({ sub: null }))).rejects.toThrow();
  });

  it("does not call a failure to reach the tenant's keys a bad token", async () => {
    const down = jwtVerifier(settings, async () => {
      throw new TypeError("fetch failed");
    });
    const rejection = await down.verify(await sign()).catch((e: unknown) => e);
    expect(rejection).toBeInstanceOf(TypeError);
    expect(rejection).not.toBeInstanceOf(TokenRejected);
    await expect(verifier.verify("not a token")).rejects.toBeInstanceOf(TokenRejected);
  });

  it("rejects an unsigned token and a made-up string", async () => {
    const unsigned = `${btoa('{"alg":"none"}')}.${btoa(JSON.stringify({ iss: ISSUER, aud: settings.audience, sub: "x" }))}.`;
    await expect(verifier.verify(unsigned)).rejects.toThrow();
    await expect(verifier.verify("not a token")).rejects.toThrow();
  });

  it("is configured from the environment, and never fake in production", () => {
    expect(authSettingsFromEnv({})).toBeUndefined();
    expect(authSettingsFromEnv({ AUTH0_DOMAIN: settings.domain, AUTH0_AUDIENCE: settings.audience })).toEqual(settings);
    expect(() => authSettingsFromEnv({ AUTH0_DOMAIN: settings.domain })).toThrow();
    // The fake login needs an explicit choice, and is never allowed in production.
    expect(() => verifierFromEnv({})).toThrow();
    expect(() => verifierFromEnv({ NODE_ENV: "production" })).toThrow();
    expect(() => verifierFromEnv({ NODE_ENV: "production", AUTH_FAKE: "1" })).toThrow();
    expect(() => verifierFromEnv({ AUTH_FAKE: "1" })).not.toThrow();
  });

  it("refuses to start in production with AUTH_FAKE set, even next to a real tenant", () => {
    const tenant = { AUTH0_DOMAIN: settings.domain, AUTH0_AUDIENCE: settings.audience };
    expect(() => verifierFromEnv({ ...tenant, NODE_ENV: "production", AUTH_FAKE: "1" })).toThrow(/AUTH_FAKE/);
    expect(() => verifierFromEnv({ ...tenant, NODE_ENV: "production" })).not.toThrow();
    expect(() => verifierFromEnv({ ...tenant, AUTH_FAKE: "1" })).not.toThrow();
  });
});

describe("who a request acts as", () => {
  let keys: Awaited<ReturnType<typeof makeKeys>>;
  let app: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    keys = await makeKeys();
    app = await startTestApp(undefined, undefined, jwtVerifier(settings, keys.jwks));
  });
  beforeEach(() => app.reset());
  afterAll(() => app.stop());

  const realToken = (sub: string, exp: string | number = "5m") =>
    new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: keys.kid }).setIssuer(ISSUER).setAudience(settings.audience).setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(keys.privateKey);
  const asAccount = async (sub: string) => ({ authorization: `Bearer ${await realToken(sub)}` });
  const guest = () => crypto.randomUUID();
  const me = async (headers: Record<string, string>) => fetch(`${app.baseUrl}/api/me`, { headers });
  const jsonHeaders = (headers: Record<string, string>) => ({ ...headers, "content-type": "application/json" });
  const createTrip = async (headers: Record<string, string>, title: string) =>
    tripSchema.parse(await (await fetch(`${app.baseUrl}/api/trips`, { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title }) })).json());
  const listTitles = async (headers: Record<string, string>) =>
    z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`, { headers })).json()).map((t) => t.title).sort();

  it("keeps the health check open", async () => {
    expect((await fetch(`${app.baseUrl}/api/health`, { headers: { "x-no-auth": "1" } })).status).toBe(200);
  });

  it("refuses a request with no token and no guest id", async () => {
    const res = await fetch(`${app.baseUrl}/api/trips`, { headers: { "x-no-auth": "1" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "no_session" });
  });

  it("refuses a bad token, and does not fall back to the guest id", async () => {
    const res = await fetch(`${app.baseUrl}/api/trips`, { headers: { authorization: "Bearer garbage", "x-guest-id": guest() } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "invalid_token" });
  });

  it("refuses an expired token", async () => {
    const expired = await realToken("auth0|abc", Math.floor(Date.now() / 1000) - 60);
    expect((await me({ authorization: `Bearer ${expired}` })).status).toBe(401);
  });

  it("refuses a guest id that is not a uuid", async () => {
    expect((await me({ "x-guest-id": "hello" })).status).toBe(401);
  });

  it("creates the user for a new account once, keyed by the Auth0 subject", async () => {
    const headers = await asAccount("auth0|lena");
    const first = (await (await me(headers)).json()) as { id: string; guest: boolean };
    const second = (await (await me(await asAccount("auth0|lena"))).json()) as { id: string };
    expect(first.guest).toBe(false);
    expect(second.id).toBe(first.id);
    const rows = await app.db.select().from(users).where(eq(users.auth0Sub, "auth0|lena"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(first.id);
  });

  it("treats a guest id as an anonymous user of its own", async () => {
    const id = guest();
    const first = (await (await me({ "x-guest-id": id })).json()) as { id: string; guest: boolean };
    const again = (await (await me({ "x-guest-id": id })).json()) as { id: string };
    const other = (await (await me({ "x-guest-id": guest() })).json()) as { id: string };
    expect(first.guest).toBe(true);
    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
  });

  it("owns Trips per user: nobody sees another's", async () => {
    const lena = await asAccount("auth0|lena");
    const mei = await asAccount("auth0|mei");
    const visitor = { "x-guest-id": guest() };
    await createTrip(lena, "Lena's");
    await createTrip(mei, "Mei's");
    await createTrip(visitor, "Guest's");
    expect(await listTitles(lena)).toEqual(["Lena's"]);
    expect(await listTitles(mei)).toEqual(["Mei's"]);
    expect(await listTitles(visitor)).toEqual(["Guest's"]);
  });

  it("does not let one user change another's Trip", async () => {
    const lena = await asAccount("auth0|lena");
    const trip = await createTrip(lena, "Lena's");
    const res = await fetch(`${app.baseUrl}/api/trips/${trip.id}`, { method: "PATCH", headers: jsonHeaders(await asAccount("auth0|mei")), body: JSON.stringify({ startDate: "2026-11-03" }) });
    expect(res.status).toBe(404);
  });
});

describe("guest merge on login", () => {
  let app: Awaited<ReturnType<typeof startTestApp>>;
  beforeAll(async () => {
    app = await startTestApp();
  });
  beforeEach(() => app.reset());
  afterAll(() => app.stop());

  const account = { authorization: `Bearer ${testToken("auth0|lena")}` };
  const jsonHeaders = (headers: Record<string, string>) => ({ ...headers, "content-type": "application/json" });
  const createTrip = (headers: Record<string, string>, title: string) =>
    fetch(`${app.baseUrl}/api/trips`, { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title }) });
  const titles = async (headers: Record<string, string>) =>
    z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`, { headers })).json()).map((t) => t.title).sort();
  const merge = (headers: Record<string, string>) => fetch(`${app.baseUrl}/api/me/merge-guest`, { method: "POST", headers });

  it("adds the guest's Trips to the account and keeps the account's own", async () => {
    const id = crypto.randomUUID();
    await createTrip(account, "Taipei");
    await createTrip({ "x-guest-id": id }, "Kyoto");
    await createTrip({ "x-guest-id": id }, "Osaka");

    const res = await merge({ ...account, "x-guest-id": id });
    expect(await res.json()).toEqual({ merged: 2 });
    expect(await titles(account)).toEqual(["Kyoto", "Osaka", "Taipei"]);
  });

  it("keeps a Trip's content and Todos when it moves", async () => {
    const id = crypto.randomUUID();
    const guest = { "x-guest-id": id };
    const trip = z.object({ id: z.string() }).parse(await (await createTrip(guest, "Kyoto")).json());
    await fetch(`${app.baseUrl}/api/trips/${trip.id}/todos`, { method: "POST", headers: jsonHeaders(guest), body: JSON.stringify({ text: "Buy tickets", eventId: null }) });

    await merge({ ...account, "x-guest-id": id });
    const [moved] = z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`, { headers: account })).json());
    expect(moved!.todos.map((t) => t.text)).toEqual(["Buy tickets"]);
  });

  it("removes the guest and does nothing the second time", async () => {
    const id = crypto.randomUUID();
    await createTrip({ "x-guest-id": id }, "Kyoto");
    await merge({ ...account, "x-guest-id": id });
    expect(await app.db.select().from(users).where(eq(users.guestToken, id))).toHaveLength(0);

    const again = await merge({ ...account, "x-guest-id": id });
    expect(await again.json()).toEqual({ merged: 0 });
    expect(await titles(account)).toEqual(["Kyoto"]);
  });

  it("is fine with no guest, an unknown guest, or a guest with no Trips", async () => {
    await createTrip(account, "Taipei");
    expect(await (await merge(account)).json()).toEqual({ merged: 0 });
    expect(await (await merge({ ...account, "x-guest-id": crypto.randomUUID() })).json()).toEqual({ merged: 0 });
    const empty = crypto.randomUUID();
    await fetch(`${app.baseUrl}/api/me`, { headers: { "x-guest-id": empty } });
    expect(await (await merge({ ...account, "x-guest-id": empty })).json()).toEqual({ merged: 0 });
    expect(await titles(account)).toEqual(["Taipei"]);
  });

  it("is for accounts only: a guest cannot merge, and cannot take another guest's Trips", async () => {
    const victim = crypto.randomUUID();
    await createTrip({ "x-guest-id": victim }, "Kyoto");
    const res = await merge({ "x-guest-id": crypto.randomUUID() });
    expect(res.status).toBe(401);
    expect(await titles({ "x-guest-id": victim })).toEqual(["Kyoto"]);
  });

  it("moves nothing when the guest id is the account's own user", async () => {
    // mergeGuest guards against a guest row that is the account itself.
    const [row] = await app.db.insert(users).values({ guestToken: crypto.randomUUID() }).returning();
    await app.db.insert(trips).values({ ownerId: row!.id, title: "Mine" });
    expect(await mergeGuest(app.db, row!.id, row!.guestToken!)).toBe(0);
    expect(await app.db.select().from(trips).where(eq(trips.ownerId, row!.id))).toHaveLength(1);
  });
});
