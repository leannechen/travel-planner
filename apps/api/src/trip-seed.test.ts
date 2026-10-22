import { tripSchema } from "@travel-planner/shared";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test/test-app";
import { users } from "./db/schema";
import { fakePlaceProvider } from "./places";
import { fakeRouteProvider } from "./routes";
import { writeTripSeed } from "./trip-seed";

let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(() => app.reset());
afterAll(() => app.stop());

const deps = { places: fakePlaceProvider(), routes: fakeRouteProvider() };
const guestUser = async () => {
  const guest = crypto.randomUUID();
  const [user] = await app.db.insert(users).values({ guestToken: guest }).returning({ id: users.id });
  return { userId: user!.id, headers: { "x-guest-id": guest } };
};
const tripsOf = async (headers: Record<string, string>) =>
  z.array(tripSchema).parse(await (await fetch(`${app.baseUrl}/api/trips`, { headers })).json());

describe("writing a Trip seed", () => {
  it("writes the Days in order, the holding areas, Todos and only the Legs that were asked for", async () => {
    const { userId, headers } = await guestUser();
    const tripId = await writeTripSeed(app.db, deps, userId, {
      title: "Kyoto",
      startDate: "2026-11-03",
      travelMode: "walk",
      days: [
        [
          { title: "Kiyomizu-dera", placeId: "fake:kiyomizu-dera", startMinute: 540, durationMinutes: 90, legToNext: "walk", todos: [{ text: "Bring coins" }] },
          { title: "Pontocho", kind: "meal", placeId: "fake:pontocho", startMinute: 660, durationMinutes: 60, legToNext: "transit" },
          { title: "Nanzen-ji", placeId: "fake:nanzen-ji", startMinute: 780, durationMinutes: 60 },
          { title: "Lodging", kind: "lodging", nights: 1, placeId: "fake:pontocho", startMinute: 900, legToNext: "walk" },
        ],
        [],
      ],
      backlog: [{ title: "Tenryu-ji", placeId: "fake:tenryu-ji" }],
      archive: [{ title: "Old idea" }],
      todos: [{ text: "Buy a rail pass", done: true }],
    });

    const [trip] = await tripsOf(headers);
    expect(trip).toMatchObject({ id: tripId, title: "Kyoto", startDate: "2026-11-03", travelMode: "walk", role: "owner" });
    expect(trip!.days.map((d) => d.events.length)).toEqual([4, 0]);
    expect(trip!.backlog.map((e) => e.title)).toEqual(["Tenryu-ji"]);
    expect(trip!.archive.map((e) => e.title)).toEqual(["Old idea"]);

    const kiyomizu = trip!.days[0]!.events.find((e) => e.title === "Kiyomizu-dera")!;
    expect(trip!.todos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: kiyomizu.id, text: "Bring coins", done: false }),
        expect.objectContaining({ eventId: null, text: "Buy a rail pass", done: true }),
      ]),
    );

    // Kiyomizu-dera → Pontocho and Pontocho → Nanzen-ji; Nanzen-ji asks for none and Lodging has none.
    const title = (id: string) => trip!.days[0]!.events.find((e) => e.id === id)!.title;
    expect(trip!.legs.map((l) => [title(l.fromEventId), title(l.toEventId), l.mode]).sort()).toEqual([
      ["Kiyomizu-dera", "Pontocho", "walk"],
      ["Pontocho", "Nanzen-ji", "transit"],
    ]);
  });

  it("writes nothing for a second copy of the same sample", async () => {
    const { userId, headers } = await guestUser();
    const seed = { title: "Sample", days: [[]] };
    expect(await writeTripSeed(app.db, deps, userId, seed, { sampleOf: "kyoto-osaka" })).toBeDefined();
    expect(await writeTripSeed(app.db, deps, userId, seed, { sampleOf: "kyoto-osaka" })).toBeUndefined();
    expect(await tripsOf(headers)).toHaveLength(1);
  });

  it("keeps the seed's order in the Backlog and the Todos", async () => {
    const { userId, headers } = await guestUser();
    const titles = ["A", "B", "C", "D", "E", "F"];
    await writeTripSeed(app.db, deps, userId, {
      title: "Order",
      days: [[]],
      backlog: titles.map((title) => ({ title })),
      todos: titles.map((text) => ({ text })),
    });
    const [trip] = await tripsOf(headers);
    expect(trip!.backlog.map((e) => e.title)).toEqual(titles);
    expect(trip!.todos.map((t) => t.text)).toEqual(titles);
  });

  it("starts a Transport event's Leg at its destination, and keeps opening hours only with a place", async () => {
    const { userId, headers } = await guestUser();
    await writeTripSeed(app.db, deps, userId, {
      title: "Osaka",
      days: [
        [
          { title: "Train", kind: "transport", placeId: "fake:kyoto-station", destinationId: "fake:osaka-station", startMinute: 540, legToNext: "walk" },
          { title: "Osaka Castle", placeId: "fake:osaka-castle", startMinute: 660, openingHoursOn: true },
          { title: "Somewhere", startMinute: 780, openingHoursOn: true },
        ],
      ],
    });
    const [trip] = await tripsOf(headers);
    const [train, castle, somewhere] = [...trip!.days[0]!.events].sort((a, b) => a.startMinute - b.startMinute);
    expect(trip!.legs).toEqual([expect.objectContaining({ fromEventId: train!.id, toEventId: castle!.id, mode: "walk" })]);
    expect([castle!.openingHoursOn, somewhere!.openingHoursOn]).toEqual([true, false]);
  });

  it("refuses a seed the app could not make itself", async () => {
    const { userId, headers } = await guestUser();
    const refused = [
      { title: "No Days", days: [] },
      { title: "No nights", days: [[{ title: "Hotel", kind: "lodging" as const }]] },
      { title: "Too long a stay", days: [[{ title: "Hotel", kind: "lodging" as const, nights: 2 }]] },
      { title: "Archived Todos", days: [[]], archive: [{ title: "Old", todos: [{ text: "Gone" }] }] },
    ];
    for (const seed of refused) await expect(writeTripSeed(app.db, deps, userId, seed)).rejects.toThrow();
    expect(await tripsOf(headers)).toEqual([]);
  });
});
