import { aiItinerarySchema, MAX_AI_DAYS, MAX_AI_EVENTS_PER_DAY, type GenerateTripInput } from "@travel-planner/shared";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { fakeItineraryGenerator, GeneratorError, type ItineraryGenerator, type Usage } from "./itinerary-generator";

// Chosen from OpenAI's pricing page in October 2026: a mid-priced model ($2 in, $10 out per million
// tokens) that supports structured output. OPENAI_MODEL overrides it.
export const DEFAULT_OPENAI_MODEL = "gpt-6.1-sol";
// Room for 14 full Days with short descriptions and the model's reasoning; a longer answer is cut
// off rather than paid for in full.
const MAX_OUTPUT_TOKENS = 16_000;

// The instructions do not change between requests, so OpenAI can cache them; the date and the
// prompt come after.
const INSTRUCTIONS = `You plan trips for a travel planning app. From the user's description, write a day-by-day itinerary.

Rules:
- At most ${MAX_AI_DAYS} days and at most ${MAX_AI_EVENTS_PER_DAY} events per day (a lodging counts as one). If the user asks for more days, plan the first ${MAX_AI_DAYS}.
- Use real, specific places that exist. Plan realistic times in the local time of the place ("HH:MM", 24-hour clock) and leave time to travel between events; do not add events for walking or short local transfers.
- kind: "attraction" for sights and activities, "meal" for eating, "lodging" for where the traveller sleeps, "transport" only for a longer journey between cities (a train, flight, ferry or bus).
- placeQuery: the place to look up on Google Maps, as "Name, City, Country" (for example "Uffizi Gallery, Florence, Italy"). Use null for a general event that is not one specific place ("Lunch nearby", "Free time"). For transport, placeQuery is where it leaves from and destinationQuery where it arrives; destinationQuery is null for every other kind.
- transportLabel: for transport only ("flight", "train", "ferry", "bus" or "other"), else null.
- lodging: put it on the day of check-in, at "15:00" for 60 minutes, with nights set to how many nights the traveller sleeps there (the last day of the trip is the day of departure, with no night); nights is null for every other kind. Add a new lodging only when the traveller moves to another place to sleep.
- description: one or two short sentences of useful advice (what to see, what to order, booking tips), or null.
- title: a short name for the trip. startDate: "YYYY-MM-DD" when the description gives dates (the first such date on or after today), else null.
- If the description is not a trip that can be planned, return an empty list of days.`;

const LANGUAGE_NAMES = { en: "English", zh: "Traditional Chinese as used in Taiwan" } as const;

// The part of the OpenAI client this uses, so tests can give their own.
export type ResponsesClient = { responses: Pick<OpenAI["responses"], "parse"> };

// The real generator (ADR 0008): one structured-output request to the Responses API. The model's
// answer is checked against `aiItinerarySchema` by the SDK.
// "Today" is the UTC date: a day off near midnight only matters for a prompt that says "tomorrow".
export function openAiItineraryGenerator(client: ResponsesClient, model = DEFAULT_OPENAI_MODEL, today: () => Date = () => new Date()): ItineraryGenerator {
  return {
    async generate(input: GenerateTripInput, signal?: AbortSignal) {
      let response;
      try {
        response = await client.responses.parse(
          {
            model,
            instructions: INSTRUCTIONS,
            input: [
              {
                role: "user",
                content: `Today is ${today().toISOString().slice(0, 10)}. Write the trip title, the event titles and the descriptions in ${LANGUAGE_NAMES[input.language]}; write place queries in English or the local language, as Google Maps knows the place.\n\nTrip description:\n${input.prompt}`,
              },
            ],
            reasoning: { effort: "low" },
            max_output_tokens: MAX_OUTPUT_TOKENS,
            // Nothing reads a stored response, so the user's description is not kept at OpenAI.
            store: false,
            text: { format: zodTextFormat(aiItinerarySchema, "itinerary") },
          },
          // The generation's own deadline stops it; one retry for a passing error.
          { signal, maxRetries: 1 },
        );
      } catch (err) {
        if (err instanceof OpenAI.APIError) throw new GeneratorError(`OpenAI request failed: ${err.message}`, "failed");
        // The model answered, but not with the schema (the SDK checks it): unusable. The token counts
        // are not known on this path.
        if (err instanceof z.ZodError || err instanceof SyntaxError) throw new GeneratorError(`The answer did not match the schema: ${err.message}`, "unusable");
        throw err;
      }

      const usage: Usage | undefined = response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : undefined;
      const refused = response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
      if (refused) throw new GeneratorError("The model refused the prompt", "unusable", usage);
      // Cut off: the model answered (and it was paid for) but too long, or it was filtered.
      if (response.status === "incomplete") throw new GeneratorError(`The answer was incomplete (${response.incomplete_details?.reason ?? "unknown"})`, "unusable", usage);
      // The service failed or cancelled the response: trying again may work.
      if (response.status !== "completed") throw new GeneratorError(`The response ${response.status ?? "has no status"}`, "failed", usage);
      if (!response.output_parsed) throw new GeneratorError("The answer had no itinerary", "unusable", usage);
      return { itinerary: response.output_parsed, usage };
    },
  };
}

// OpenAI when OPENAI_API_KEY is set; otherwise the fake generator, slowed down so the waiting state shows.
export function itineraryGeneratorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  makeClient: (apiKey: string) => ResponsesClient = (apiKey) => new OpenAI({ apiKey }),
): ItineraryGenerator {
  if (env.OPENAI_API_KEY) {
    const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    console.log(`AI generation uses OpenAI, model ${model}`);
    return openAiItineraryGenerator(makeClient(env.OPENAI_API_KEY), model);
  }
  console.warn("No AI model is set up: AI generation uses the fake generator (development only)");
  return fakeItineraryGenerator({ delayMs: 3000 });
}
