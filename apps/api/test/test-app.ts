import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { vi } from "vitest";
import { createApp } from "../src/app";
import { fakeTokenVerifier, GUEST_HEADER, type TokenVerifier } from "../src/auth";
import { fakeRouteProvider, type RouteProvider } from "../src/routes";
import { fakePlaceProvider, type PlaceProvider } from "../src/places";
import { createDb } from "../src/db/client";
import { TEST_DATABASE_URL } from "./global-setup";

export const testToken = (sub = "test-user") => `fake:${sub}`;

// Starts the app against the test database. Call reset() before each test.
export async function startTestApp(places: PlaceProvider = fakePlaceProvider(), routes: RouteProvider = fakeRouteProvider(), auth: TokenVerifier = fakeTokenVerifier()) {
  const { db, pool } = createDb(TEST_DATABASE_URL);

  let server!: Server;
  await new Promise<void>((resolve) => {
    server = createApp(db, { places, routes, auth }).listen(0, () => resolve());
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
    async reset() {
      await db.execute(sql`truncate table events, days, trips, users, places, route_estimates cascade`);
    },
    async stop() {
      vi.stubGlobal("fetch", realFetch);
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await pool.end();
    },
  };
}
