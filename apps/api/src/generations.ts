import { AI_DAILY_ATTEMPTS, AI_DAILY_LIMIT, normalizeItinerary, type GeneratedTrip, type GenerateTripInput, type Generation, type GenerationsSummary, type TripSeedInput } from "@travel-planner/shared";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { aiGenerations } from "./db/schema";
import { GeneratorError, type ItineraryGenerator } from "./itinerary-generator";
import type { LegDeps } from "./legs";
import { findPlaceIds } from "./places";
import { writeTripSeed } from "./trip-seed";

export type GenerationDeps = LegDeps & { generator: ItineraryGenerator };

type Row = typeof aiGenerations.$inferSelect;
const toGeneration = (row: Row): Generation => ({ id: row.id, status: row.status, tripId: row.tripId, failure: row.failure });

// Midnight UTC of the day `now` is in: the daily limit starts again then.
const startOfDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

// How long the model may take. A generation still running well past it (its run was lost, or the
// server stopped) is failed, so it does not block the user's next one.
export const GENERATION_TIMEOUT_MS = 3 * 60 * 1000;
const STALE_MS = GENERATION_TIMEOUT_MS + 60 * 1000;

// Today's generations, as the limits see them. One that the model answered counts, even when the
// answer was unusable (it was paid for); one that failed for another reason does not, but every
// attempt counts towards a second, larger cap, so failures cannot be repeated without end.
type Executor = Pick<Db, "select">;
async function remainingToday(db: Executor, userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({
      attempts: count(),
      counted: count(sql`case when ${aiGenerations.status} <> 'failed' or ${aiGenerations.failure} = 'unusable' then 1 end`),
    })
    .from(aiGenerations)
    .where(and(eq(aiGenerations.userId, userId), gte(aiGenerations.createdAt, startOfDay(now))));
  return Math.max(Math.min(AI_DAILY_LIMIT - (row?.counted ?? 0), AI_DAILY_ATTEMPTS - (row?.attempts ?? 0)), 0);
}

const failStale = (db: Db, userId: string, now: Date) =>
  db
    .update(aiGenerations)
    .set({ status: "failed", failure: "failed", finishedAt: now })
    .where(and(eq(aiGenerations.userId, userId), eq(aiGenerations.status, "running"), lt(aiGenerations.createdAt, new Date(now.getTime() - STALE_MS))));

export async function generationsSummary(db: Db, userId: string, now = new Date()): Promise<GenerationsSummary> {
  await failStale(db, userId, now);
  const [running] = await db.select().from(aiGenerations).where(and(eq(aiGenerations.userId, userId), eq(aiGenerations.status, "running")));
  return { remaining: await remainingToday(db, userId, now), running: running ? toGeneration(running) : null };
}

export async function getGeneration(db: Db, userId: string, id: string, now = new Date()): Promise<Generation | undefined> {
  await failStale(db, userId, now);
  const [row] = await db
    .select()
    .from(aiGenerations)
    .where(and(eq(aiGenerations.id, id), eq(aiGenerations.userId, userId)));
  return row && toGeneration(row);
}

// Starts a generation and answers at once; the work goes on in the background (`done` settles when
// it is over, and never rejects). "limit" when the user has used today's generations, "running" when
// one of theirs is still running (the unique index allows one at a time). The count and the insert
// hold a lock per user, so two requests cannot both take the last one.
export async function startGeneration(
  db: Db,
  deps: GenerationDeps,
  userId: string,
  input: GenerateTripInput,
  now = new Date(),
): Promise<{ generation: Generation; done: Promise<void> } | "limit" | "running"> {
  await failStale(db, userId, now);
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    if ((await remainingToday(tx, userId, now)) === 0) return "limit" as const;
    const [inserted] = await tx
      .insert(aiGenerations)
      .values({ userId, prompt: input.prompt, language: input.language })
      .onConflictDoNothing()
      .returning();
    return inserted ?? ("running" as const);
  });
  if (row === "limit" || row === "running") return row;
  return { generation: toGeneration(row), done: run(db, deps, row, input) };
}

// The model's answer, or a GeneratorError when it took longer than allowed (the generator is told to
// stop through its signal).
export async function generateInTime(generator: ItineraryGenerator, input: GenerateTripInput, timeoutMs = GENERATION_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new GeneratorError("The model took too long", "failed"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([generator.generate(input, controller.signal), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function run(db: Db, deps: GenerationDeps, row: Row, input: GenerateTripInput): Promise<void> {
  // Only a generation still running is finished: one already failed (as stale, or by a server
  // start) stays failed.
  const finish = (fields: Partial<Row>) =>
    db
      .update(aiGenerations)
      .set({ ...fields, finishedAt: new Date() })
      .where(and(eq(aiGenerations.id, row.id), eq(aiGenerations.status, "running")));
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  let tripId: string | undefined;
  let failure: "unusable" | "failed" = "failed";
  try {
    const answer = await generateInTime(deps.generator, input);
    usage = answer.usage;
    const trip = normalizeItinerary(answer.itinerary, { fallbackTitle: input.prompt.slice(0, 60) });
    if (!trip) throw new GeneratorError("The itinerary has no Events", "unusable");
    tripId = await writeTripSeed(db, deps, row.userId, await withPlaces(db, deps, trip));
  } catch (err) {
    if (!(err instanceof GeneratorError)) console.error("AI generation failed", err);
    if (err instanceof GeneratorError) {
      failure = err.failure;
      usage = err.usage ?? usage;
    }
  }
  const tokens = { inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null };
  // Nobody waits for this promise, so it must not reject. A Trip that was written is done, whatever
  // went wrong after.
  await finish(tripId ? { status: "done", tripId, ...tokens } : { status: "failed", failure, ...tokens }).catch((e: unknown) =>
    console.error("AI generation could not be finished", e),
  );
}

// The generated Trip with its place queries looked up. A query that finds nothing, or that the
// provider could not answer, leaves its Event without a place.
async function withPlaces(db: Db, deps: GenerationDeps, trip: GeneratedTrip): Promise<TripSeedInput> {
  const events = trip.days.flat();
  const ids = await findPlaceIds(
    db,
    deps.places,
    events.flatMap((e) => [e.placeQuery, e.destinationQuery].filter((q): q is string => q !== null)),
  );
  const idOf = (query: string | null) => (query ? (ids.get(query) ?? null) : null);
  return {
    title: trip.title,
    startDate: trip.startDate,
    days: trip.days.map((list) =>
      list.map(({ placeQuery, destinationQuery, ...e }) => ({ ...e, placeId: idOf(placeQuery), destinationId: idOf(destinationQuery) })),
    ),
  };
}

// A generation cannot outlive the server it ran in: when the server starts, any left running failed.
// This assumes one API process; with several, a starting one would fail the others' generations.
export async function failInterruptedGenerations(db: Db): Promise<void> {
  await db.update(aiGenerations).set({ status: "failed", failure: "failed", finishedAt: new Date() }).where(eq(aiGenerations.status, "running"));
}
