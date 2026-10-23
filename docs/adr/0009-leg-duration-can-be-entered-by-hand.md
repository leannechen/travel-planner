# A Leg's duration can be entered by hand where Google has no transit routes

Google's Routes API gives no public-transit routes in Japan (its own FAQ: "The Routes API supports all Google Transit partners, except the Indian Railway Catering and Tourism Corporation and those in Japan", <https://developers.google.com/maps/faq#transit_directions_countries>; investigated in implementation step 34). Public transit is how most people travel in Japan, so a Leg that can only say "cannot calculate" is a real gap. The user can now enter the duration of such a Leg in minutes, usually after looking the route up in Google Maps (the Leg popover keeps its "Open in Google Maps" link, where Japanese transit is shown).

A Leg stores whether its duration was entered by hand (a `manual` flag). A manual duration has no distance (distance stays empty) and is shown as entered by the user. The server never replaces it with a calculation on its own: changing the travel mode or the location of either Event drops it, because it described another trip, and the Leg is calculated again for the new mode and places. Changing only an Event's time does not recalculate any Leg (step 34), so the app reminds the user that the Leg's duration was entered by hand and may no longer match the timetable.

This does not change ADR 0002: Legs are still created by the user. It only adds a second source for the duration of a Leg that already exists.

## Considered Options

- **A Japanese route provider (NAVITIME, Ekispert)**: accurate times, lines and transfers, and the right long-term answer if Japan trips matter. It adds a vendor, a key, a cost and licence terms (storing and showing results), none of which has been looked into. Left for later; the `RouteProvider` interface is where it would plug in, chosen by country, with Google unchanged elsewhere. Nothing here prevents it, and the manual duration remains useful as an override.
- **Estimate transit time from the distance**: no vendor, but the number would look like a calculation and be wrong often (trains and walking between stations are not a speed over a distance).
- **Hide public transit in Japan**: honest, but it removes the mode people want and the user would still have no way to plan the day.
- **Do nothing but explain it** (the first fix of step 34): the user can switch to Drive or Walk, which are wrong for travel in Japan.

## Notes

- Whether a Trip is "in Japan" is never decided by the app: the input appears for any Leg with two places whose duration cannot be calculated, in any travel mode, so it also covers other countries Google leaves out and a pair with no route.
- The backup and `TripSeed` keep a Leg as a mode only (step 23a); a manual duration is lost on import until the seed carries it (step 24a).
