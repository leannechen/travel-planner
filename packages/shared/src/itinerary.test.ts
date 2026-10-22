import { describe, expect, it } from "vitest";
import type { AiEvent, AiItinerary } from "./index";
import { normalizeItinerary } from "./itinerary";

const event = (fields: Partial<AiEvent> = {}): AiEvent => ({
  title: "Kenroku-en",
  kind: "attraction",
  start: "09:00",
  durationMinutes: 90,
  placeQuery: "Kenroku-en, Kanazawa",
  destinationQuery: null,
  transportLabel: null,
  nights: null,
  description: null,
  ...fields,
});
const itinerary = (days: AiEvent[][], fields: Partial<AiItinerary> = {}): AiItinerary => ({
  title: "Kanazawa",
  startDate: null,
  days: days.map((events) => ({ events })),
  ...fields,
});
const normalize = (it: AiItinerary) => normalizeItinerary(it, { fallbackTitle: "Kanazawa, 3 days" });

describe("normalizing a generated itinerary", () => {
  it("keeps a usable itinerary as it is, with no Legs", () => {
    const trip = normalize(itinerary([[event({ description: "  The garden.  " })]], { startDate: "2026-11-03" }))!;
    expect(trip).toEqual({
      title: "Kanazawa",
      startDate: "2026-11-03",
      days: [
        [
          expect.objectContaining({
            title: "Kenroku-en",
            kind: "attraction",
            startMinute: 540,
            durationMinutes: 90,
            placeQuery: "Kenroku-en, Kanazawa",
            destinationQuery: null,
            description: "The garden.",
            legToNext: null,
          }),
        ],
      ],
    });
  });

  it("gives up on an itinerary without Days or Events", () => {
    expect(normalize(itinerary([]))).toBeUndefined();
    expect(normalize(itinerary([[], []]))).toBeUndefined();
    expect(normalize(itinerary([[event({ title: "   " })]]))).toBeUndefined();
  });

  it("uses the fallback title and drops a date that is not one", () => {
    const trip = normalize(itinerary([[event()]], { title: "  ", startDate: "early November" }))!;
    expect(trip.title).toBe("Kanazawa, 3 days");
    expect(trip.startDate).toBeNull();
  });

  it("keeps at most 14 Days and 6 Events a Day, and drops Events without a title", () => {
    const day = [event({ title: "" }), ...Array.from({ length: 8 }, (_, i) => event({ title: `E${i}` }))];
    const trip = normalize(itinerary(Array.from({ length: 20 }, () => day)))!;
    expect(trip.days).toHaveLength(14);
    expect(trip.days[0]!.map((e) => e.title)).toEqual(["E0", "E1", "E2", "E3", "E4", "E5"]);
  });

  it("puts times on the 15-minute grid and keeps durations within a day", () => {
    const times = [
      event({ start: "9:07", durationMinutes: 50 }),
      event({ start: "25:00", durationMinutes: 0 }),
      event({ start: "noon", durationMinutes: 5000 }),
      event({ start: "23:59", durationMinutes: Number.NaN }),
    ];
    expect(normalize(itinerary([times]))!.days[0]!.map((e) => [e.startMinute, e.durationMinutes])).toEqual([
      [540, 45],
      [540, 15],
      [540, 1425],
      [1425, 60],
    ]);
  });

  it("keeps a Lodging's nights within the Trip, with check-in and check-out times", () => {
    const hotel = (nights: number | null) => event({ kind: "lodging", title: "Hotel", nights });
    const trip = normalize(itinerary([[hotel(5)], [hotel(null)], [hotel(0)]]))!;
    expect(trip.days.map((d) => d[0]!.nights)).toEqual([3, 1, 1]);
    expect(trip.days[0]![0]).toMatchObject({ checkInMinute: 900, checkOutMinute: 660 });
  });

  it("keeps the Transport fields only on Transport", () => {
    const trip = normalize(
      itinerary([
        [
          event({ kind: "transport", title: "Train", placeQuery: "Kanazawa Station", destinationQuery: "Kyoto Station", transportLabel: null }),
          event({ kind: "meal", title: "Lunch", placeQuery: null, destinationQuery: "Somewhere", transportLabel: "train", nights: 2 }),
        ],
      ]),
    )!;
    expect(trip.days[0]![0]).toMatchObject({ transportLabel: "other", placeQuery: "Kanazawa Station", destinationQuery: "Kyoto Station" });
    expect(trip.days[0]![1]).toMatchObject({ transportLabel: null, destinationQuery: null, nights: null, placeQuery: null });
  });

  it("looks up at most 60 different places; a repeated place counts once", () => {
    const days = Array.from({ length: 14 }, (_, d) =>
      Array.from({ length: 6 }, (_, i) => event({ title: `P${d}-${i}`, placeQuery: i === 0 ? "  hotel ABC " : `Place ${d}-${i}` })),
    );
    const queries = normalize(itinerary(days))!.days.flat().map((e) => e.placeQuery);
    expect(new Set(queries.filter((q) => q !== null).map((q) => q.toLowerCase())).size).toBe(60);
    // The hotel is on every Day and was counted once, so it keeps its place everywhere.
    expect(normalize(itinerary(days))!.days.map((d) => d[0]!.placeQuery)).toEqual(Array(14).fill("hotel ABC"));
    expect(queries.at(-1)).toBeNull();
  });
});
