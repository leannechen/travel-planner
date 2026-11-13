import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  // An idle connection can be closed by the server, for example when Neon suspends or restarts its
  // compute. The pool then drops it and emits "error", which would stop the process if nothing
  // listened; the next query simply opens a new connection.
  pool.on("error", (err) => console.error("Idle database connection lost", err));
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>["db"];

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
}
