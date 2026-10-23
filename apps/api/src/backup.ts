import { buildBackup, type Backup, type SeedImage } from "@travel-planner/shared";
import { inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import { eventImages } from "./db/schema";
import type { ImageStore } from "./images";
import { listTrips } from "./trips";

// The full backup of a Trip (PRD §9) for its Owner or an Editor, or undefined when the Trip is not
// theirs. The uploaded images are read from the store and carried in the file.
export async function exportBackup(db: Db, store: ImageStore, userId: string, tripId: string): Promise<Backup | undefined> {
  const [trip] = await listTrips(db, userId, tripId);
  if (!trip) return undefined;

  const eventIds = [...trip.days.flatMap((d) => d.events), ...trip.backlog, ...trip.archive].filter((e) => e.imageId !== null).map((e) => e.id);
  const rows = eventIds.length === 0 ? [] : await db.select().from(eventImages).where(inArray(eventImages.eventId, eventIds));
  const images = new Map<string, SeedImage>();
  for (const row of rows) {
    const bytes = await store.get(row.storageKey);
    // A file the store has lost leaves the Event without its image rather than failing the backup.
    if (bytes) images.set(row.eventId, { contentType: row.contentType as SeedImage["contentType"], data: bytes.toString("base64") });
  }
  return buildBackup(trip, images);
}
