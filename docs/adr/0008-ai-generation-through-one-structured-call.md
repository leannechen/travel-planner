# AI generation is one structured call; the server resolves places

Generating a Trip (PRD §7) is a single request to a language model that returns an itinerary as JSON matching a Zod schema in `packages/shared`. The model does not look anything up: each Event carries an optional place query ("Uffizi Gallery, Florence"), and the server turns it into a place id with the place provider, as the sample Trip does. The result becomes a `TripSeed` (a Trip's content without ids, nested Days and Events) that one function writes to the database; the sample Trip and the backup import (step 24) write through the same function.

The model sits behind an `ItineraryGenerator` interface with a fake implementation (no key needed) and one real implementation, chosen by an environment variable. The first real one uses the OpenAI API (`openai` package, `responses.parse` with a Zod schema). Because the call is plain structured output with no tools, providers are interchangeable: another one is a new implementation of the interface, and the schema, the prompt and the place resolution stay as they are.

The real places come from the place provider, not from the model, so a made-up place cannot reach a Trip: a query the provider does not find leaves that Event without a place. This also keeps the work bounded. The number of Days, Events per Day and place lookups per generation is capped in the schema and enforced again on the server, since place lookups cost more than the model call.

## Considered Options

- **Let the model call a place-search tool**: it could check its own choices, but it means several model turns, more latency and an unbounded number of place lookups.
- **Let the model use web search**: adds cost and still gives no place ids.
- **A provider-agnostic library (Vercel AI SDK)**: one more abstraction layer; the small interface here is enough to switch providers.

## Notes

- With OpenAI strict structured output every field must be required, so fields that may be absent are `nullable` in the schema rather than optional.
- A generation's searches ask Google for ids only (the place search of the Location field still needs names and addresses to list) (the free Text Search Essentials IDs Only SKU) and then read the details through the `places` cache; a `place_queries` table remembers which id a query found, so a popular place is not searched again.
