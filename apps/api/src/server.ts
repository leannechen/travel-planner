import { createApp } from "./app";
import { createDb, runMigrations } from "./db/client";
import { ensureDevUser } from "./dev-user";

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const { db } = createDb(databaseUrl);
await runMigrations(db);
await ensureDevUser(db);

createApp(db).listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
