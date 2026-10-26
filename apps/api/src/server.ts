import { createApp } from "./app";
import { listenLive } from "./live";
import { authSettingsFromEnv, verifierFromEnv } from "./auth";
import { createDb, runMigrations } from "./db/client";
import { failInterruptedGenerations } from "./generations";
import { pruneGuests } from "./guests";
import { imageStoreFromEnv } from "./images";
import { pruneUsage } from "./usage";

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
// A wrong login setup must stop the start before anything touches the database.
const auth = verifierFromEnv();
if (!authSettingsFromEnv()) console.warn("AUTH0_DOMAIN is not set: accepting fake tokens (development only)");

const { db } = createDb(databaseUrl);
await runMigrations(db);
await failInterruptedGenerations(db);
// Counts of past days are not needed any more.
await pruneUsage(db);
setInterval(() => void pruneUsage(db).catch((err: unknown) => console.error("Could not prune usage counts", err)), 60 * 60 * 1000).unref();

// Guests unseen for a month go with their Trips and images; checked at start and then daily.
const images = imageStoreFromEnv();
const removeStaleGuests = () =>
  pruneGuests(db, images)
    .then((count) => count > 0 && console.log(`Removed ${count} guest(s) unseen for a month`))
    .catch((err: unknown) => console.error("Could not remove stale guests", err));
await removeStaleGuests();
setInterval(() => void removeStaleGuests(), 24 * 60 * 60 * 1000).unref();

listenLive(createApp(db, { auth, images }), port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
