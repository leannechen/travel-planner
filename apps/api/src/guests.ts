import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { Db } from "./db/client";
import { eventImages, events, trips, users } from "./db/schema";
import type { ImageStore } from "./images";

// How long a guest session can go unseen before it, and the Trips in it, are removed (PRD §8, Guest
// use: a guest's data lives in the browser's session; clearing it loses the Trips anyway).
export const GUEST_RETENTION_DAYS = 30;

// Removes the guests unseen for GUEST_RETENTION_DAYS with their Trips and uploaded images. Returns
// how many guests went. A guest who logged in is already gone (mergeGuest), with nothing left here.
export async function pruneGuests(db: Db, images: ImageStore, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - GUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const keys: string[] = [];
  const removed = await db.transaction(async (tx) => {
    // Locked, so a guest who comes back meanwhile is not removed half-way.
    const stale = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(isNotNull(users.guestToken), lt(users.lastSeenAt, cutoff)))
      .for("update", { skipLocked: true });
    const ids = stale.map((guest) => guest.id);
    if (ids.length === 0) return 0;
    const files = await tx
      .select({ key: eventImages.storageKey })
      .from(eventImages)
      .innerJoin(events, eq(events.id, eventImages.eventId))
      .innerJoin(trips, eq(trips.id, events.tripId))
      .where(inArray(trips.ownerId, ids));
    keys.push(...files.map((file) => file.key));
    // The Trips first: neither a Trip's owner nor its Todos' author cascades from the user.
    await tx.delete(trips).where(inArray(trips.ownerId, ids));
    await tx.delete(users).where(inArray(users.id, ids));
    return ids.length;
  });
  await Promise.allSettled(keys.map((key) => images.delete(key)));
  return removed;
}
