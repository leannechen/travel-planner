import { Pool } from "pg";
import { createDb, runMigrations } from "../src/db/client";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://travel:travel@localhost:5432/travel_planner_test";

// Creates the test database when it does not exist yet, then applies migrations.
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);

  const admin = new Pool({ connectionString: new URL("/postgres", url).toString() });
  const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
  if (!rowCount) await admin.query(`create database "${dbName}"`);
  await admin.end();

  const { db, pool } = createDb(TEST_DATABASE_URL);
  await runMigrations(db);
  await pool.end();
}
