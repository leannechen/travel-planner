import { eventSchema, invitationSchema, sharingSchema, tripSchema } from "@travel-planner/shared";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test/test-app";
import { auth0IdentityAdmin, IdentityAdminError } from "./sharing";

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

function call(method: string, path: string, token: string | undefined, body?: unknown) {
  return fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : { "x-no-auth": "1" }), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function ownerTrip() {
  const trip = tripSchema.parse(await (await call("POST", "/api/trips", OWNER, { title: "Kyoto & Osaka" })).json());
  return trip;
}

async function invite(tripId: string, email = "mei@example.com") {
  const res = await call("POST", `/api/trips/${tripId}/invitations`, OWNER, { email });
  return { res, invitation: res.status === 201 ? invitationSchema.parse(await res.json()) : undefined };
}

async function joined(tripId: string) {
  const { invitation } = await invite(tripId);
  const res = await call("POST", `/api/invitations/${invitation!.token}/accept`, MEI);
  expect(res.status).toBe(200);
  return invitation!;
}

describe("inviting", () => {
  it("creates an invitation that waits in the Share list, and asking again gives the same one", async () => {
    const trip = await ownerTrip();
    const first = await invite(trip.id, "  Mei@Example.com ");
    const second = await invite(trip.id);

    expect(first.res.status).toBe(201);
    expect(first.invitation).toMatchObject({ email: "mei@example.com" });
    expect(second.invitation!.token).toBe(first.invitation!.token);
    const sharing = sharingSchema.parse(await (await call("GET", `/api/trips/${trip.id}/sharing`, OWNER)).json());
    expect(sharing).toEqual({ editors: [], invitations: [first.invitation] });
    expect(app.mails[0]).toEqual({
      to: "mei@example.com",
      inviterEmail: "lena@example.com",
      tripTitle: "Kyoto & Osaka",
      link: `http://app.test/?invite=${first.invitation!.token}`,
    });
  });

  it("rejects an address that is not an email", async () => {
    const trip = await ownerTrip();
    expect((await invite(trip.id, "not an email")).res.status).toBe(400);
  });

  it("does not let the Owner invite themselves", async () => {
    const trip = await ownerTrip();
    const { res } = await invite(trip.id, "lena@example.com");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "own_address" });
  });

  it("is for the Owner only", async () => {
    const trip = await ownerTrip();
    await joined(trip.id);

    expect((await call("POST", `/api/trips/${trip.id}/invitations`, MEI, { email: "x@example.com" })).status).toBe(404);
    expect((await call("GET", `/api/trips/${trip.id}/sharing`, MEI)).status).toBe(404);
    expect((await call("GET", `/api/trips/${trip.id}/sharing`, "fake:other@example.com")).status).toBe(404);
  });

  it("cannot withdraw an invitation that was accepted", async () => {
    const trip = await ownerTrip();
    const invitation = await joined(trip.id);
    expect((await call("DELETE", `/api/trips/${trip.id}/invitations/${invitation.id}`, OWNER)).status).toBe(404);
  });

  it("can revoke an invitation, which then stops working", async () => {
    const trip = await ownerTrip();
    const { invitation } = await invite(trip.id);

    expect((await call("DELETE", `/api/trips/${trip.id}/invitations/${invitation!.id}`, OWNER)).status).toBe(204);

    expect((await call("GET", `/api/invitations/${invitation!.token}`, undefined)).status).toBe(404);
    expect((await call("POST", `/api/invitations/${invitation!.token}/accept`, MEI)).status).toBe(404);
  });
});

describe("guests", () => {
  it("cannot share a Trip", async () => {
    const guest = { "x-guest-id": crypto.randomUUID(), "content-type": "application/json" };
    const trip = tripSchema.parse(await (await fetch(`${app.baseUrl}/api/trips`, { method: "POST", headers: guest, body: JSON.stringify({ title: "Mine" }) })).json());
    const invitation = await fetch(`${app.baseUrl}/api/trips/${trip.id}/invitations`, { method: "POST", headers: guest, body: JSON.stringify({ email: "mei@example.com" }) });
    const sharing = await fetch(`${app.baseUrl}/api/trips/${trip.id}/sharing`, { headers: guest });
    expect([invitation.status, sharing.status]).toEqual([401, 401]);
  });
});

describe("the invitation page", () => {
  it("names the Trip and a masked invited address to someone who is not logged in", async () => {
    const trip = await ownerTrip();
    await call("GET", "/api/me", OWNER);
    const { invitation } = await invite(trip.id);

    const res = await call("GET", `/api/invitations/${invitation!.token}`, undefined);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tripTitle: "Kyoto & Osaka", invitedEmail: "m*i@example.com", inviterEmail: "lena@example.com" });
  });

  it("is gone once the invitation was accepted", async () => {
    const trip = await ownerTrip();
    const invitation = await joined(trip.id);
    expect((await call("GET", `/api/invitations/${invitation.token}`, undefined)).status).toBe(404);
  });

  it("does not know a made-up link", async () => {
    expect((await call("GET", "/api/invitations/nope", undefined)).status).toBe(404);
  });
});

describe("accepting", () => {
  it("makes a verified account with the invited address an Editor", async () => {
    const trip = await ownerTrip();
    const { invitation } = await invite(trip.id);

    const res = await call("POST", `/api/invitations/${invitation!.token}/accept`, MEI);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tripId: trip.id, tripTitle: "Kyoto & Osaka" });
    const trips = z.array(tripSchema).parse(await (await call("GET", "/api/trips", MEI)).json());
    expect(trips.map((t) => [t.id, t.role])).toEqual([[trip.id, "editor"]]);
    const sharing = sharingSchema.parse(await (await call("GET", `/api/trips/${trip.id}/sharing`, OWNER)).json());
    expect(sharing.editors.map((e) => e.email)).toEqual(["mei@example.com"]);
    expect(sharing.invitations).toEqual([]);
  });

  it("matches the address regardless of case", async () => {
    const trip = await ownerTrip();
    const { invitation } = await invite(trip.id, "MEI@example.com");
    expect((await call("POST", `/api/invitations/${invitation!.token}/accept`, MEI)).status).toBe(200);
  });

  it("refuses an account with another address", async () => {
    const trip = await ownerTrip();
    const { invitation } = await invite(trip.id);

    const res = await call("POST", `/api/invitations/${invitation!.token}/accept`, "fake:mei@work.example");

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "wrong_account" });
    expect(z.array(tripSchema).parse(await (await call("GET", "/api/trips", "fake:mei@work.example")).json())).toEqual([]);
  });

  it("refuses an account without an email address", async () => {
    const trip = await ownerTrip();
    const { invitation } = await invite(trip.id);
    const res = await call("POST", `/api/invitations/${invitation!.token}/accept`, "fake:some-user");
    expect(await res.json()).toMatchObject({ code: "wrong_account" });
  });

  it("waits for the address to be verified", async () => {
    const trip = await ownerTrip();
    const { invitation } = await invite(trip.id);

    const res = await call("POST", `/api/invitations/${invitation!.token}/accept`, "fake-unverified:mei@example.com");

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "email_not_verified" });
    // Once verified (a new token says so), the same link works.
    expect((await call("POST", `/api/invitations/${invitation!.token}/accept`, MEI)).status).toBe(200);
  });

  it("needs an account, not a guest session", async () => {
    const trip = await ownerTrip();
    const { invitation } = await invite(trip.id);
    const res = await fetch(`${app.baseUrl}/api/invitations/${invitation!.token}/accept`, {
      method: "POST",
      headers: { "x-guest-id": crypto.randomUUID() },
    });
    expect(res.status).toBe(401);
  });

  it("answers the same when the same account asks again, and refuses everyone else", async () => {
    const trip = await ownerTrip();
    const invitation = await joined(trip.id);

    expect((await call("POST", `/api/invitations/${invitation.token}/accept`, MEI)).status).toBe(200);
    expect((await call("POST", `/api/invitations/${invitation.token}/accept`, "fake:late@example.com")).status).toBe(404);
  });
});

describe("what an Editor may do", () => {
  it("edits the Trip's Events and Todos but not the sharing", async () => {
    const trip = await ownerTrip();
    await joined(trip.id);
    const dayId = trip.days[0]!.id;

    const added = await call("POST", `/api/trips/${trip.id}/days/${dayId}/events`, MEI, { title: "Fushimi Inari" });
    expect(added.status).toBe(201);
    const event = eventSchema.parse(await added.json());
    expect((await call("PATCH", `/api/trips/${trip.id}/events/${event.id}`, MEI, { title: "Fushimi Inari Taisha" })).status).toBe(200);
    expect((await call("POST", `/api/trips/${trip.id}/todos`, MEI, { text: "Buy tickets", eventId: null })).status).toBe(201);
    expect((await call("POST", `/api/trips/${trip.id}/notes`, MEI, { body: "Ideas" })).status).toBe(201);
    expect((await call("PATCH", `/api/trips/${trip.id}`, MEI, { startDate: "2026-11-03" })).status).toBe(200);

    const seenByOwner = z.array(tripSchema).parse(await (await call("GET", "/api/trips", OWNER)).json());
    expect(seenByOwner[0]!.days[0]!.events.map((e) => e.title)).toEqual(["Fushimi Inari Taisha"]);
    expect(seenByOwner[0]!.role).toBe("owner");
  });

  it("loses access when the Owner removes them", async () => {
    const trip = await ownerTrip();
    await joined(trip.id);
    const sharing = sharingSchema.parse(await (await call("GET", `/api/trips/${trip.id}/sharing`, OWNER)).json());

    expect((await call("DELETE", `/api/trips/${trip.id}/editors/${sharing.editors[0]!.userId}`, OWNER)).status).toBe(204);

    expect(z.array(tripSchema).parse(await (await call("GET", "/api/trips", MEI)).json())).toEqual([]);
    expect((await call("POST", `/api/trips/${trip.id}/days/${trip.days[0]!.id}/events`, MEI, { title: "x" })).status).toBe(404);
    // The address can be invited again.
    expect((await invite(trip.id)).res.status).toBe(201);
  });

  it("cannot be removed by anyone but the Owner", async () => {
    const trip = await ownerTrip();
    await joined(trip.id);
    const sharing = sharingSchema.parse(await (await call("GET", `/api/trips/${trip.id}/sharing`, OWNER)).json());
    expect((await call("DELETE", `/api/trips/${trip.id}/editors/${sharing.editors[0]!.userId}`, MEI)).status).toBe(404);
  });
});

describe("resending the verification email", () => {
  it("is for accounts", async () => {
    const res = await fetch(`${app.baseUrl}/api/me/resend-verification`, { method: "POST", headers: { "x-guest-id": crypto.randomUUID() } });
    expect(res.status).toBe(401);
  });

  it("answers 204 once Auth0 was asked", async () => {
    expect((await call("POST", "/api/me/resend-verification", "fake-unverified:mei@example.com")).status).toBe(204);
    expect(app.resends).toEqual(["mei@example.com"]);
  });
});

describe("Auth0 management API", () => {
  const settings = { domain: "tenant.example.auth0.com", clientId: "client", clientSecret: "secret" };

  it("asks for a token and then for the verification email of the user", async () => {
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ access_token: "mgmt-token" }), { status: 200 });
    }) as unknown as typeof fetch;

    await auth0IdentityAdmin(settings, fetchFn).resendVerification("auth0|abc");

    expect(calls.map((c) => c.url)).toEqual(["https://tenant.example.auth0.com/oauth/token", "https://tenant.example.auth0.com/api/v2/jobs/verification-email"]);
    expect(calls[0]!.body).toMatchObject({ grant_type: "client_credentials", client_id: "client", client_secret: "secret", audience: "https://tenant.example.auth0.com/api/v2/" });
    expect(calls[1]!.headers.authorization).toBe("Bearer mgmt-token");
    expect(calls[1]!.body).toEqual({ user_id: "auth0|abc" });
  });

  it("reports a refusal as its own error", async () => {
    const fetchFn = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    await expect(auth0IdentityAdmin(settings, fetchFn).resendVerification("auth0|abc")).rejects.toBeInstanceOf(IdentityAdminError);
  });
});
