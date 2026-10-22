# Operations: the places of the sample Trip

The sample Trip (`apps/api/src/sample-trip.ts`) keeps a Google place id for each of its places in
`SAMPLE_PLACES`. Opening a sample copy uses the pinned id when the provider knows it, and searches
by the place's name when it does not (the fake provider, or an id Google no longer knows).

This check is **not in CI**: it needs a real `GOOGLE_MAPS_API_KEY` and calls Google Places (billed),
and Google's answer can change without any change in this repo. Run it by hand.

## When to run it

- After adding, renaming or replacing a place in `SAMPLE_PLACES`.
- When a sample copy shows a wrong or missing place (an Event with no location, or a different
  place on the map). Google place ids can change; the name fallback hides this, so the symptom is
  an Event that lost its Google details, not an error.
- Before a release, at least every few months.

## How to run it

```sh
npm run sample-places -w @travel-planner/api
```

The script reads `GOOGLE_MAPS_API_KEY` from `.env` (without a key it uses the fake provider and
prints fake ids, which is not what you want). For each place it prints the first search hit for the
name and up to two other hits:

```
kiyomizu: "Kiyomizu-dera"
  -> ChIJB_vchdMIAWARujTEUIZlr2I  Kiyomizu-dera | 1-chōme-294 Kiyomizu, Higashiyama Ward, Kyoto, ...
```

## What to check

1. Each first hit is the intended place (name and address), not a branch, a shop or a park of the
   same name.
2. It matches the `id` in `SAMPLE_PLACES`. If it does not, and the new hit is right, replace the
   `id`; if the old id still resolves to the right place, leave it.
3. A place with an opening-hours warning in the sample (Kinkaku-ji, Nanzen-ji) still has hours on
   Google, and the warning still shows. Google Maps lists no hours for some places (Nishiki
   Market has none), and a place without hours cannot show the warning.

Then open a fresh sample copy (delete the old one from the Trip list first) and look at Day 1 and
Day 2 on the schedule and the map.
