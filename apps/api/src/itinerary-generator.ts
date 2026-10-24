import { MAX_AI_DAYS, type AiEvent, type AiItinerary, type GenerateTripInput } from "@travel-planner/shared";

// What turns a prompt into an itinerary (ADR 0008). The answer is checked against the schema by the
// implementation; making it fit the app's rules is `normalizeItinerary`'s job.
export type ItineraryGenerator = {
  // `signal` aborts when the generation has taken too long.
  generate(input: GenerateTripInput, signal?: AbortSignal): Promise<{ itinerary: AiItinerary; usage?: Usage }>;
};

// The tokens the model used, kept for the cost.
export type Usage = { inputTokens: number; outputTokens: number };

// Why a generation could not make an itinerary: "unusable" when the model could not or would not
// plan this prompt, "failed" when the service went wrong and trying again may work. `usage` when the
// model was called (an unusable answer was still paid for).
export class GeneratorError extends Error {
  constructor(
    message: string,
    readonly failure: "unusable" | "failed",
    readonly usage?: Usage,
  ) {
    super(message);
  }
}

type Stop = { en: string; zh: string; query: string; kind?: AiEvent["kind"]; start: string; minutes: number };

// Day plans the fake repeats; the queries are places the fake place provider knows.
const FAKE_DAYS: Stop[][] = [
  [
    { en: "Fushimi Inari Taisha", zh: "伏見稻荷大社", query: "Fushimi Inari Taisha", start: "08:30", minutes: 120 },
    { en: "Lunch at Nishiki Market", zh: "錦市場午餐", query: "Nishiki Market", kind: "meal", start: "12:00", minutes: 75 },
    { en: "Kiyomizu-dera", zh: "清水寺", query: "Kiyomizu-dera", start: "14:30", minutes: 120 },
    { en: "Dinner in Pontocho", zh: "先斗町晚餐", query: "Pontocho", kind: "meal", start: "18:30", minutes: 90 },
  ],
  [
    { en: "Arashiyama Bamboo Grove", zh: "嵐山竹林", query: "Arashiyama Bamboo Grove", start: "08:30", minutes: 90 },
    { en: "Tenryu-ji", zh: "天龍寺", query: "Tenryu-ji", start: "10:15", minutes: 75 },
    { en: "Kinkaku-ji", zh: "金閣寺", query: "Kinkaku-ji", start: "14:00", minutes: 90 },
  ],
  [
    { en: "Nara Park", zh: "奈良公園", query: "Nara Park", start: "09:30", minutes: 120 },
    { en: "Todai-ji", zh: "東大寺", query: "Todai-ji", start: "12:00", minutes: 90 },
  ],
];

const FAKE_DELAY_MS = 0;

// The travel mode the fake finds in a prompt: "by car", "drive", "開車", "on foot", "walk", "走路", "步行".
const fakeModeOf = (prompt: string): AiItinerary["travelMode"] =>
  /by car|drive|driving|road trip|開車|自駕/i.test(prompt) ? "drive" : /on foot|walk|走路|步行/i.test(prompt) ? "walk" : null;

// A generator for development and tests that needs no key: a few days around Kyoto, as many as the
// prompt asks for ("5 days", "5 天"; 3 otherwise). A prompt with "[unusable]" or "[fail]" fails that
// way, so those states can be tried.
export function fakeItineraryGenerator(options: { delayMs?: number } = {}): ItineraryGenerator {
  return {
    async generate({ prompt, language }) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? FAKE_DELAY_MS));
      if (prompt.includes("[fail]")) throw new GeneratorError("The fake generator was asked to fail", "failed");
      if (prompt.includes("[unusable]")) throw new GeneratorError("The fake generator was asked for nothing usable", "unusable", { inputTokens: 100, outputTokens: 10 });

      // A little over the limit, so trimming to it can be tried; never as many as a prompt may ask.
      const count = Math.min(Number(/(\d+)\s*(days?|天|日)/i.exec(prompt)?.[1] ?? 3) || 3, MAX_AI_DAYS + 2);
      const name = (stop: { en: string; zh: string }) => (language === "zh" ? stop.zh : stop.en);
      const event = (stop: Stop): AiEvent => ({
        title: name(stop),
        kind: stop.kind ?? "attraction",
        start: stop.start,
        durationMinutes: stop.minutes,
        placeQuery: stop.query,
        destinationQuery: null,
        transportLabel: null,
        nights: null,
        description: null,
      });
      const hotel: AiEvent = { ...event({ en: "Hotel Granvia Kyoto", zh: "京都格蘭比亞大酒店", query: "Hotel Granvia Kyoto", start: "15:00", minutes: 60 }), kind: "lodging", nights: count };
      const days = Array.from({ length: count }, (_, i) => ({ events: [...(i === 0 ? [hotel] : []), ...FAKE_DAYS[i % FAKE_DAYS.length]!.map(event)] }));
      return {
        itinerary: { title: language === "zh" ? `京都 ${count} 日` : `${count} days in Kyoto`, startDate: null, travelMode: fakeModeOf(prompt), days },
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}
