# Legs are created by the user, not generated automatically

A Leg between two adjacent Events exists only after the user clicks the time slot between them; the system never creates Legs on its own. This keeps Google Maps API usage proportional to what the user cares about, and avoids filling the schedule with movement the user does not want to track. A Leg is removed automatically when its two Events stop being adjacent, and shows "cannot calculate" if an Event loses its location.

## Considered Options

- **Auto-generate a Leg between every pair of located Events**: always-complete travel times, but many API calls and noisy schedules.
