import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { vi } from "vitest";
import { createApp } from "../src/app";
import { listenLive } from "../src/live";
import { fakeTokenVerifier, GUEST_HEADER, type TokenVerifier } from "../src/auth";
import { fakeRouteProvider, type RouteProvider } from "../src/routes";
import { fakePlaceProvider, type PlaceProvider } from "../src/places";
import type { IdentityAdmin, InvitationMailer } from "../src/sharing";
import { createDb } from "../src/db/client";
import { TEST_DATABASE_URL } from "./global-setup";

export const testToken = (sub = "test-user") => `fake:${sub}`;

// Starts the app against the test database. Call reset() before each test.
export async function startTestApp(places: PlaceProvider = fakePlaceProvider(), routes: RouteProvider = fakeRouteProvider(), auth: TokenVerifier = fakeTokenVerifier()) {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  // What would have been sent: invitations by email, and requests to Auth0 to send a verification email again.
  const mails: Parameters<InvitationMailer["send"]>[0][] = [];
  const resends: string[] = [];
  const mailer: InvitationMailer = { send: async (mail) => void mails.push(mail) };
  const identityAdmin: IdentityAdmin = { resendVerification: async (sub) => void resends.push(sub) };

  let server!: Server;
  let live!: { close(): void };
  await new Promise<void>((resolve) => {
    const app = createApp(db, { places, routes, auth, mailer, identityAdmin, appOrigin: "http://app.test" });
    live = app.locals.live;
    server = listenLive(app, 0, () => resolve());
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Requests to the app act as the account "test-user" unless they bring their own credentials
  // (an authorization or guest header), or say "x-no-auth" to bring none.
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (String(input).startsWith(baseUrl) && !headers.has("authorization") && !headers.has(GUEST_HEADER) && !headers.has("x-no-auth")) {
      headers.set("authorization", `Bearer ${testToken()}`);
    }
    headers.delete("x-no-auth");
    return realFetch(input, { ...init, headers });
  });

  return {
    baseUrl,
    db,
    mails,
    resends,
    async reset() {
      mails.length = 0;
      resends.length = 0;
      await db.execute(sql`truncate table events, days, trips, users, places, route_estimates cascade`);
    },
    async stop() {
      vi.stubGlobal("fetch", realFetch);
      live.close();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await pool.end();
    },
  };
}
