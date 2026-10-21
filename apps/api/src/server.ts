import { createApp } from "./app";
import { listenLive } from "./live";
import { authSettingsFromEnv, verifierFromEnv } from "./auth";
import { createDb, runMigrations } from "./db/client";

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const { db } = createDb(databaseUrl);
await runMigrations(db);

const auth = verifierFromEnv();
if (!authSettingsFromEnv()) console.warn("AUTH0_DOMAIN is not set: accepting fake tokens (development only)");

listenLive(createApp(db, { auth }), port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
