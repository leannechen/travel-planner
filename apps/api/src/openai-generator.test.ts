import type { AiItinerary } from "@travel-planner/shared";
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeneratorError } from "./itinerary-generator";
import { DEFAULT_OPENAI_MODEL, itineraryGeneratorFromEnv, openAiItineraryGenerator, type ResponsesClient } from "./openai-generator";

const itinerary: AiItinerary = {
  title: "Taipei food weekend",
  startDate: null,
  travelMode: null,
  days: [
    {
      events: [
        {
          title: "Raohe Night Market",
          kind: "meal",
          start: "19:00",
          durationMinutes: 90,
          placeQuery: "Raohe Street Night Market, Taipei, Taiwan",
          destinationQuery: null,
          transportLabel: null,
          nights: null,
          description: "Try the pepper buns at the entrance.",
        },
      ],
    },
  ],
};

// What `responses.parse` answers, as far as the generator reads it.
const answer = (fields: Record<string, unknown> = {}) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
  output_parsed: itinerary,
  usage: { input_tokens: 1200, output_tokens: 3400 },
  ...fields,
});
const clientAnswering = (result: unknown) => {
  const parse = vi.fn(async () => result);
  return { client: { responses: { parse } } as unknown as ResponsesClient, parse };
};
const today = () => new Date("2026-10-23T08:00:00Z");
const input = { prompt: "A food weekend in Taipei", language: "zh" as const };

describe("the OpenAI generator", () => {
  it("asks for the itinerary schema with the prompt, today's date and the language, and returns it with the tokens used", async () => {
    const { client, parse } = clientAnswering(answer());
    const signal = new AbortController().signal;
    const result = await openAiItineraryGenerator(client, DEFAULT_OPENAI_MODEL, today).generate(input, signal);
    expect(result).toEqual({ itinerary, usage: { inputTokens: 1200, outputTokens: 3400 } });

    const [body, options] = parse.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(body).toMatchObject({ model: "gpt-6.1-sol", reasoning: { effort: "low" }, max_output_tokens: 16_000, store: false, text: { format: { type: "json_schema", name: "itinerary", strict: true } } });
    expect(body.instructions).toContain("At most 14 days and at most 6 events per day");
    const content = JSON.stringify(body.input);
    expect(content).toContain("Today is 2026-10-23");
    expect(content).toContain("Traditional Chinese as used in Taiwan");
    expect(content).toContain("A food weekend in Taipei");
    expect(options).toEqual({ signal, maxRetries: 1 });
  });

  it("calls a refusal or an answer without an itinerary unusable, keeping the tokens", async () => {
    const refusal = answer({ output: [{ type: "message", content: [{ type: "refusal", refusal: "I can't help with that." }] }], output_parsed: null });
    await expect(openAiItineraryGenerator(clientAnswering(refusal).client).generate(input)).rejects.toMatchObject({
      failure: "unusable",
      usage: { inputTokens: 1200, outputTokens: 3400 },
    });
    await expect(openAiItineraryGenerator(clientAnswering(answer({ output_parsed: null })).client).generate(input)).rejects.toMatchObject({ failure: "unusable" });
  });

  it("calls an answer that was cut off or did not match the schema unusable, as the model answered", async () => {
    const cut = answer({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
    await expect(openAiItineraryGenerator(clientAnswering(cut).client).generate(input)).rejects.toMatchObject({
      failure: "unusable",
      usage: { inputTokens: 1200, outputTokens: 3400 },
    });
    for (const thrown of [new z.ZodError([]), new SyntaxError("Error reading response: invalid structured output JSON.")]) {
      const client = { responses: { parse: vi.fn(async () => Promise.reject(thrown)) } } as unknown as ResponsesClient;
      await expect(openAiItineraryGenerator(client).generate(input)).rejects.toMatchObject({ failure: "unusable" });
    }
  });

  it("fails a response the service failed, a request that failed, and one stopped by the deadline", async () => {
    await expect(openAiItineraryGenerator(clientAnswering(answer({ status: "failed", output_parsed: null })).client).generate(input)).rejects.toMatchObject({ failure: "failed" });
    const aborted = { responses: { parse: vi.fn(async () => Promise.reject(new OpenAI.APIUserAbortError())) } } as unknown as ResponsesClient;
    await expect(openAiItineraryGenerator(aborted).generate(input)).rejects.toMatchObject({ failure: "failed" });

    const failing = { responses: { parse: vi.fn(async () => Promise.reject(new OpenAI.APIError(503, undefined, "Service unavailable", new Headers()))) } } as unknown as ResponsesClient;
    const error = await openAiItineraryGenerator(failing).generate(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error).toMatchObject({ failure: "failed" });
  });

  it("uses OpenAI only when a key is set, with the model from OPENAI_MODEL or the default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const makeClient = vi.fn(() => clientAnswering(answer()).client);
    itineraryGeneratorFromEnv({}, makeClient);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fake generator"));
    expect(makeClient).not.toHaveBeenCalled();
    warn.mockRestore();

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const models = async (env: NodeJS.ProcessEnv) => {
      const { client, parse } = clientAnswering(answer());
      await itineraryGeneratorFromEnv(env, () => client).generate(input);
      return (parse.mock.calls[0] as unknown as [{ model: string }])[0].model;
    };
    expect(await models({ OPENAI_API_KEY: "sk-test" })).toBe(DEFAULT_OPENAI_MODEL);
    expect(await models({ OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-6-luna" })).toBe("gpt-6-luna");
    expect(console.log).toHaveBeenLastCalledWith("AI generation uses OpenAI, model gpt-6-luna");
    vi.mocked(console.log).mockRestore();
  });
});
