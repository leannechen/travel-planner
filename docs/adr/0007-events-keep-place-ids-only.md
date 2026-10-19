# Events keep place ids only; place data is a cache

An Event stores the place provider's id of its place (and, for a Transport event, of its destination), nothing else. The name, address and coordinates are read through the server, which keeps them in a `places` table as a cache and fetches them again when they are older than 30 days. Searching fills the cache, so choosing a result needs no second lookup.

Google's Places policies allow storing place ids indefinitely but not the rest of the place content beyond a limited caching time. Keeping an id on the Event follows that rule by construction: nothing in a Trip, a backup or an export holds Google content that could go stale or be kept too long. It also keeps the provider swappable: step 14 shipped with a fake provider that needs no key, and Google is used when `GOOGLE_MAPS_API_KEY` is set.

The cost is one extra lookup before a place can be shown (the web app keeps looked-up places for the session) and a place that Google no longer knows simply disappears from the cache; the Event keeps the id and shows no place data.

## Considered Options

- **Store name, address and coordinates on the Event**: the simplest read path, but it keeps Google content indefinitely, against the policy, and the copies would go stale.
- **Store coordinates only**: still Google content, and loses the name that the user chose the place by.

## Notes

- The 30-day limit is the figure the Maps Platform terms are known to use for cached place content. The Service Specific Terms page could not be read in full when this was decided, so the exact wording must be checked again before release (plan step 27).
- Place photos are not stored at all: they need the author's attribution and a link to the place on Google Maps, so a later step fetches them when they are shown. See PRD §3.2.
