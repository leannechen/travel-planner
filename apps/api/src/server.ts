import { createApp } from "./app";
import { listenLive } from "./live";
import { authSettingsFromEnv, verifierFromEnv } from "./auth";
import { createDb, runMigrations } from "./db/client";
import { failInterruptedGenerations } from "./generations";
import { pruneUsage } from "./usage";

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const { db } = createDb(databaseUrl);
await runMigrations(db);
await failInterruptedGenerations(db);
// Counts of past days are not needed any more.
await pruneUsage(db);
setInterval(() => void pruneUsage(db).catch((err: unknown) => console.error("Could not prune usage counts", err)), 60 * 60 * 1000).unref();

const auth = verifierFromEnv();
if (!authSettingsFromEnv()) console.warn("AUTH0_DOMAIN is not set: accepting fake tokens (development only)");

listenLive(createApp(db, { auth }), port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
