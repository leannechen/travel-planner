# Travel Planner

A tool for planning trips, alone or with others: arrange attractions, meals, lodging and transport across days, and review travel time and a map.

## Language

**Trip**:
A complete travel plan: a set of Days, the two holding areas, Todos and Notes. Calendar dates are optional.
_Avoid_: Itinerary, plan, project

**Day**:
One numbered day of a Trip (Day 1, Day 2, ...), holding Events on a time axis. Day numbers always follow position and exist even when dates do not; a calendar date is optional display information. Days can be reordered, inserted and deleted.
_Avoid_: List, column

**Event**:
A block placed in a Day or a holding area, with a kind. Inside a Day it has a start time and a duration; in a holding area it has a duration only. A location is optional.
_Avoid_: Item, card, activity

**Attraction**:
An Event kind for a sight or place to visit.
_Avoid_: Location, sight, place

**Meal**:
An Event kind for a restaurant or a meal.

**Lodging**:
An Event kind for accommodation. It has a check-in Day and a number of nights instead of a start time and duration, and appears as a thin banner at the top of each Day it covers and on its check-out Day.
_Avoid_: Hotel, accommodation

**Transport event**:
An Event kind for transport with its own character, created by the user (for example a ferry or a scenic train). It has departure and arrival times and may have a departure and a destination place.
_Avoid_: Travel

**Leg**:
A plain movement between two adjacent Events, created when the user clicks the time slot between them. Its duration is computed from the two locations; the user only picks the travel mode (drive, public transit, walk). It cannot exist if either Event has no location.
_Avoid_: Travel, route, commute

**Backlog**:
A holding area outside any Day for Events the user is still considering.
_Avoid_: Parking Lot, maybe list

**Archive**:
A holding area outside any Day for Events the user has given up on; they can be taken back at any time.
_Avoid_: Discard Pile, trash

**Map View**:
A secondary view that shows Event locations on a map, colored by Day, and lets the user open an Event to edit it. The default and complete editing experience stays in the time-axis view of the Days.

**Description**:
The Markdown text attached to one Event, holding that Event's details (for example check-in time or booking notes).
_Avoid_: Notes, memo

**Note**:
A standalone free-form Markdown entry in a Trip's notes list, for quick drafts. It has no link to any Event, Day or other component. Visible to the Owner and Editors only.
_Avoid_: Memo, scratchpad

**Todo**:
A to-do item, either a Trip Todo (belongs to the whole Trip) or an Event Todo (belongs to one Event). Event Todos are deleted when their Event is put in the Archive or deleted.
_Avoid_: Task, checklist item

## Roles and sharing

**Owner**:
The user who owns a Trip and can edit it.

**Editor**:
A logged-in user invited by email to edit a Trip alongside the Owner. Can edit Events, Legs and Todos, and sees Todos and the Archive; cannot delete the Trip, invite people or change sharing.
_Avoid_: Collaborator, member

**Viewer**:
A person who opens a Trip read-only through a share link, without logging in.
_Avoid_: Guest, reader
