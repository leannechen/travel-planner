import { afterAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createDb } from "./client";
import { TEST_DATABASE_URL } from "../../test/global-setup";

describe("createDb", () => {
  const { pool } = createDb(TEST_DATABASE_URL);
  const admin = new Pool({ connectionString: TEST_DATABASE_URL });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  it("keeps running when the server closes an idle connection", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const client = await pool.connect();
      const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
      client.release();

      const lost = new Promise<void>((resolve) => pool.once("error", () => resolve()));
      await admin.query("select pg_terminate_backend($1)", [rows[0]?.pid]);
      await lost;

      expect(logged).toHaveBeenCalledWith("Idle database connection lost", expect.any(Error));
      const { rows: after } = await pool.query<{ one: number }>("select 1 as one");
      expect(after[0]?.one).toBe(1);
    } finally {
      logged.mockRestore();
    }
  });
});
