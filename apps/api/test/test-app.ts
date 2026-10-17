import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { createApp } from "../src/app";
import { createDb } from "../src/db/client";
import { ensureDevUser } from "../src/dev-user";
import { TEST_DATABASE_URL } from "./global-setup";

// Starts the app against the test database. Call reset() before each test.
export async function startTestApp() {
  const { db, pool } = createDb(TEST_DATABASE_URL);

  let server!: Server;
  await new Promise<void>((resolve) => {
    server = createApp(db).listen(0, () => resolve());
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    baseUrl,
    db,
    async reset() {
      await db.execute(sql`truncate table events, days, trips, users cascade`);
      await ensureDevUser(db);
    },
    async stop() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await pool.end();
    },
  };
}
