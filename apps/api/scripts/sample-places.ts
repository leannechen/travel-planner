// Lists what the place provider finds for each place of the sample Trip, so the ids kept in
// src/sample-trip.ts can be checked by eye. Run: npm run sample-places -w @travel-planner/api
import { SAMPLE_PLACES } from "../src/sample-trip";
import { placeProviderFromEnv } from "../src/places";

const provider = placeProviderFromEnv();
for (const [key, { name }] of Object.entries(SAMPLE_PLACES)) {
  const [first, ...rest] = await provider.search(name);
  console.log(`${key}: "${name}"`);
  console.log(first ? `  -> ${first.id}  ${first.name} | ${first.address}` : "  -> nothing found");
  for (const other of rest.slice(0, 2)) console.log(`     also ${other.id}  ${other.name} | ${other.address}`);
}
