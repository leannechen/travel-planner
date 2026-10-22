import { AI_DAILY_ATTEMPTS, AI_DAILY_LIMIT, MAX_AI_DAYS, generationSchema, generationsSummarySchema, tripSchema, type GenerateTripInput } from "@travel-planner/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp, testToken } from "../test/test-app";
import { aiGenerations, placeQueries } from "./db/schema";
import { failInterruptedGenerations, generateInTime, GENERATION_TIMEOUT_MS, generationsSummary, getGeneration } from "./generations";
import { fakeItineraryGenerator, type ItineraryGenerator } from "./itinerary-generator";
import { fakePlaceProvider, type PlaceProvider } from "./places";
import { fakeRouteProvider } from "./routes";
import { fakeTokenVerifier } from "./auth";

// The fake generator, held back while `hold` is set so a generation can be caught running.
let hold: Promise<void> | undefined;
const inner = fakeItineraryGenerator();
const generator: ItineraryGenerator = {
  async generate(input) {
    await hold;
    return inner.generate(input);
  },
};
// The fake places, counting the queries that reach the provider.
const fake = fakePlaceProvider();
let lookups: string[] = [];
const places: PlaceProvider = { ...fake, findId: (q) => (lookups.push(q), fake.findId(q)) };

let app: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  app = await startTestApp(places, fakeRouteProvider(), fakeTokenVerifier(), generator);
});
beforeEach(async () => {
  hold = undefined;
  lookups = [];
  await app.reset();
});
afterAll(() => app.stop());

type Headers = Record<string, string>;
const lena = { authorization: `Bearer ${testToken("auth0|lena")}` };
const input = (prompt = "Kyoto, 3 days, temples and food", language: GenerateTripInput["language"] = "en") => ({ prompt, language });

const start = (body: unknown, headers: Headers = lena) =>
  fetch(`${app.baseUrl}/api/generations`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
const summary = async (headers: Headers = lena) => generationsSummarySchema.parse(await (await fetch(`${app.baseUrl}/api/generations`, { headers })).json());
const trips = async (headers: Headers = lena) => z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`, { headers })).json());

// Starts a generation and waits until it is no longer running.
async function generate(body: unknown = input(), headers: Headers = lena) {
  const res = await start(body, headers);
  expect(res.status).toBe(202);
  const { id } = generationSchema.parse(await res.json());
  for (let i = 0; i < 100; i++) {
    const generation = generationSchema.parse(await (await fetch(`${app.baseUrl}/api/generations/${id}`, { headers })).json());
    if (generation.status !== "running") return generation;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The generation did not finish");
}

describe("generating a Trip with AI", () => {
  it("makes a Trip with the places it found and no Legs", async () => {
    const generation = await generate();
    expect(generation).toMatchObject({ status: "done", failure: null });

    const [trip] = await trips();
    expect(trip).toMatchObject({ id: generation.tripId, title: "3 days in Kyoto", role: "owner" });
    expect(trip!.days).toHaveLength(3);
    expect(trip!.days[0]!.events.find((e) => e.title === "Kiyomizu-dera")?.placeId).toBe("fake:kiyomizu-dera");
    expect(trip!.days[0]!.events.find((e) => e.kind === "lodging")).toMatchObject({ nights: 3, placeId: "fake:granvia-kyoto" });
    expect(trip!.legs).toEqual([]);
  });

  it("writes the Trip in the user's language", async () => {
    const generation = await generate(input("京都 2 天", "zh"));
    const [trip] = await trips();
    expect(trip).toMatchObject({ id: generation.tripId, title: "京都 2 日" });
    expect(trip!.days[0]!.events.map((e) => e.title)).toContain("清水寺");
  });

  it("searches a query once and uses what it found next time", async () => {
    await generate();
    expect(lookups.length).toBeGreaterThan(0);
    expect(new Set(lookups).size).toBe(lookups.length);
    const rows = await app.db.select().from(placeQueries).where(eq(placeQueries.query, "kiyomizu-dera"));
    expect(rows).toEqual([expect.objectContaining({ provider: "fake", placeId: "fake:kiyomizu-dera" })]);

    lookups = [];
    await generate();
    expect(lookups).toEqual([]);
  });

  it("allows three a day; one that failed before the model answered does not count", async () => {
    expect(await summary()).toEqual({ remaining: AI_DAILY_LIMIT, running: null });
    expect(await generate(input("[fail]"))).toMatchObject({ status: "failed", failure: "failed", tripId: null });
    expect((await summary()).remaining).toBe(AI_DAILY_LIMIT);
    for (let i = 0; i < AI_DAILY_LIMIT; i++) await generate();
    expect(await summary()).toEqual({ remaining: 0, running: null });

    const refused = await start(input());
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "daily_limit" });
    expect(await trips()).toHaveLength(AI_DAILY_LIMIT);
  });

  it("says when a prompt gave nothing to plan, and counts it with its tokens, as the model was paid", async () => {
    const generation = await generate(input("[unusable]"));
    expect(generation).toMatchObject({ status: "failed", failure: "unusable" });
    expect(await trips()).toEqual([]);
    expect((await summary()).remaining).toBe(AI_DAILY_LIMIT - 1);
    const [row] = await app.db.select().from(aiGenerations).where(eq(aiGenerations.id, generation.id));
    expect(row).toMatchObject({ inputTokens: 100, outputTokens: 10 });
  });

  it("caps all attempts of a day, failed ones too", async () => {
    for (let i = 0; i < AI_DAILY_ATTEMPTS; i++) await generate(input("[fail]"));
    expect(await summary()).toEqual({ remaining: 0, running: null });
    expect((await start(input())).status).toBe(429);
  });

  it("keeps a generated Trip within 14 Days however many the prompt asks for", async () => {
    const generation = await generate(input("Kyoto, 10000000 days"));
    const [trip] = await trips();
    expect(trip).toMatchObject({ id: generation.tripId });
    expect(trip!.days).toHaveLength(MAX_AI_DAYS);
  });

  it("runs one generation at a time per user and tells the page which one runs", async () => {
    let release!: () => void;
    hold = new Promise((resolve) => (release = resolve));
    const first = await start(input());
    const running = generationSchema.parse(await first.json());
    expect(running).toMatchObject({ status: "running", tripId: null });
    expect((await summary()).running).toEqual(running);

    const second = await start(input());
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "generation_running" });
    release();
  });

  it("is for accounts only, and a generation is only its owner's to see", async () => {
    const guest = { "x-guest-id": crypto.randomUUID() };
    const refused = await start(input(), guest);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "login_required" });

    const generation = await generate();
    const other = await fetch(`${app.baseUrl}/api/generations/${generation.id}`, { headers: { authorization: `Bearer ${testToken("auth0|someone")}` } });
    expect(other.status).toBe(404);
  });

  it("refuses an empty or too long prompt", async () => {
    expect((await start(input("   "))).status).toBe(400);
    expect((await start(input("x".repeat(1001)))).status).toBe(400);
    expect((await start({ prompt: "Kyoto", language: "fr" })).status).toBe(400);
  });

  it("marks a generation left running by a stopped server as failed, and it stays failed", async () => {
    let release!: () => void;
    hold = new Promise((resolve) => (release = resolve));
    const running = generationSchema.parse(await (await start(input())).json());
    await failInterruptedGenerations(app.db);
    expect((await summary()).running).toBeNull();
    release();
    await app.settle();
    const [row] = await app.db.select().from(aiGenerations).where(eq(aiGenerations.id, running.id));
    expect(row).toMatchObject({ status: "failed", failure: "failed", tripId: null });
  });

  it("fails a generation that has run far too long, so the user can start another", async () => {
    let release!: () => void;
    hold = new Promise((resolve) => (release = resolve));
    const running = generationSchema.parse(await (await start(input())).json());
    const [row] = await app.db.select().from(aiGenerations).where(eq(aiGenerations.id, running.id));
    const later = new Date(Date.now() + GENERATION_TIMEOUT_MS * 2);
    expect(await generationsSummary(app.db, row!.userId, later)).toMatchObject({ running: null });
    expect(await getGeneration(app.db, row!.userId, running.id, later)).toMatchObject({ status: "failed", failure: "failed" });
    release();
  });

  it("gives the model a deadline and tells it to stop", async () => {
    let signal: AbortSignal | undefined;
    const stuck: ItineraryGenerator = {
      generate: (_input, given) => {
        signal = given;
        return new Promise(() => undefined);
      },
    };
    await expect(generateInTime(stuck, input(), 10)).rejects.toMatchObject({ failure: "failed" });
    expect(signal?.aborted).toBe(true);
  });
});
