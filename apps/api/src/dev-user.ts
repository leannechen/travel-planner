import type { Db } from "./db/client";
import { users } from "./db/schema";

// Until sign-in exists (plan step 18), every request acts as this one user.
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

export async function ensureDevUser(db: Db) {
  await db.insert(users).values({ id: DEV_USER_ID }).onConflictDoNothing();
}
