# Travel Planner — Product Requirements

Vocabulary is defined in [`CONTEXT.md`](../CONTEXT.md); terms capitalized here (Trip, Day, Event, Leg, ...) carry those meanings. Decisions with lasting consequences are recorded in [`docs/adr/`](./adr/).

## 1. Problem and audience

People who plan trips on a desktop or phone juggle places, restaurants, lodging and transport across scattered notes, maps and chats. They need one place to arrange these by day on a time axis, see how long it takes to get between them, keep undecided ideas aside, and plan together with travel companions.

**Target users**: people who plan and organize trips using a desktop or a phone.

**First-visit goal**: a new visitor should see the product's value within seconds. Opening a sample Trip creates an editable copy, without logging in, with Events already distributed across Days.

## 2. Scope

### 2.1 In scope for v1

1. Trip planning on a Day time axis (§3)
2. Holding areas: Parking Lot and Discard Pile (§4)
3. Todos (§5)
4. Map View (§6)
5. AI-generated Trips (§7)
6. Accounts, sharing and lightweight collaboration (§8)
7. Export (§9)
8. Desktop and phone experiences (§10)

### 2.2 Next phase

- Offline read-only access to recently opened Trips
- Adding Events from the Map View

### 2.3 Explicit non-goals

Each non-goal is listed with its reason, so it is not reopened without new information.

| Non-goal | Reason |
|---|---|
| Importing Google Maps lists | No official API; the planning flow does not depend on it |
| AI that adds to an existing Trip | AI in v1 only creates a new Trip; patching an existing plan is a different problem |
| Manually editing a Leg's duration | Avoids users fighting the computed value; they can change the travel mode instead |
| Offline editing | Needs conflict handling that interacts with collaboration |
| Live cursors and merging simultaneous edits to one field | Cost far exceeds value for this domain (ADR 0003) |

## 3. Trip planning

### 3.1 Trip and Days

- A Trip has numbered Days (Day 1..N). Day numbers always exist.
- A Trip may have a start date. When set, each Day also shows its calendar date. Dates are display information and enable opening-hours checks (§3.5).
- Each Day shows its Events on a time axis.

### 3.2 Events

- An Event has a **kind**: Attraction, Meal, Lodging or Transport event. The four kinds must be visually distinguishable at a glance; the specific colors are decided in the design spec.
- Inside a Day, an Event has an absolute start time and a duration (ADR 0001). Events may overlap and are displayed side by side when they do. Editing an Event never moves another Event.
- The user can click any time on a Day's time axis (for example 10:00 or 15:30) to create an Event there, and can drag Events up and down and resize them on desktop and on phone within a Day.
- In a holding area an Event has a duration but no start time.

**Event attributes**

| Attribute | Applies to | Required |
|---|---|---|
| Title | all | yes |
| Kind | all | yes |
| Duration | all | yes |
| Location (Google Maps place or link) | all | no |
| Opening hours | Attraction, Meal | no |
| Phone, email | Attraction, Meal, Lodging | no |
| Start and end location | Transport event | no |
| Notes | all | no |
| Preview image | all | no |
| Event Todos | all | no |

- **Location is optional for every kind.** A free-text idea such as "tempura place a friend recommended in Ginza" is valid. Events without a location are ignored by Legs and the Map View.
- **Opening hours** are filled from Google place data when available and can be overridden by the user. They are stored as a per-weekday structure.
- **Preview image** defaults to the Google place photo; the user may upload a replacement. Without a photo, the kind's icon is shown.
- **Lodging** spans a range of nights and appears as a thin banner at the top of each Day it covers. It is the default start point for that Day's first Leg.

### 3.3 Legs

- A Leg is created only when the user clicks the time slot between two adjacent Events (ADR 0002). The system never creates Legs on its own.
- Both Events need a location. Its duration is computed from the two locations using the Google Maps API; the user picks the travel mode (drive, public transit, walk). A Trip has a default travel mode, chosen at creation and changeable in Trip settings; each Leg can override it.
- A Day's Lodging can be the start point of a Leg to the first Event of that Day.
- If the gap between two Events is shorter than the Leg's duration, a conflict warning is shown. Nothing is moved automatically.

**Leg lifecycle**

| Situation | Result |
|---|---|
| The two Events stop being adjacent (moved, or another Event inserted between) | Leg is removed |
| An Event's location changes | Leg duration is recalculated |
| An Event's location is cleared | Leg stays and shows "cannot calculate" |
| Either Event leaves the Day (Discard Pile, Parking Lot, deleted) | Leg is removed |

### 3.4 Transport events

A Transport event is an Event the user creates for transport with its own character (ferry, scenic train). It has its own time, notes and booking link and may have start and end locations. Legs connect the previous Event to its start location and its end location to the next Event.

### 3.5 Opening-hours check

When a Trip has dates and an Event with opening hours is placed in a Day, a warning is shown if the Event's time falls outside those hours. Warnings never block the user.

## 4. Holding areas

- **Parking Lot**: Events still being considered. **Discard Pile**: Events given up on. Neither belongs to any Day.
- An Event is scheduled by editing two fields: **Day** (Day 1..N, or "not scheduled") and **start time**. On desktop it can also be dragged between a holding area and a Day. On phone this is done only through the fields.
- Moving an Event between Days uses the same fields; on desktop it can also be dragged.
- An Event without a location can be scheduled; it simply cannot have Legs or appear on the Map View.
- Taking an Event back from the Discard Pile does not restore its deleted Event Todos.

## 5. Todos

- A **Trip Todo** belongs to the whole Trip (for example "Request leave 3/21–3/24"). An **Event Todo** belongs to one Event (for example "Book the room" on a Lodging).
- When an Event is put in the Discard Pile or deleted, its Event Todos are deleted.
  - If the Event has at least one Todo, a confirmation is shown first, stating how many Todos will be deleted, including those created by other people. The dialog offers "do not remind me again".
  - If the Event has no Todos, the action proceeds without a prompt.
- Deleting an Event can be undone for a few seconds, restoring its Todos too. Moving an Event to the Discard Pile has no undo.
- Todos have no assignee in v1.

## 6. Map View

- Shows Event locations on a Google Map, colored by Day, with the ability to show one Day or all Days.
- Clicking a marker opens the same edit panel as the time-axis view.
- Parking Lot Events are shown with a gray marker by default, so the user can judge which Day they fit; this can be turned off.
- Events without a location do not appear.
- The default and complete editing experience stays in the time-axis view. Adding Events from the map is a next-phase feature.

## 7. AI-generated Trips

- From a free-text prompt such as "Kanazawa, Japan, 5 days", the system creates a new Trip with Events on Days.
- Preferences are part of the free text (for example "likes hot springs, relaxed pace"); there are no structured fields in v1.
- Generated Events use real Google Maps places and are scheduled with times. The user edits the result; they may discard it and generate again.
- AI is limited to creating new Trips and does not read existing Trip content.
- Usage is limited per user per day. The sample Trip is pre-built and does not call AI.

## 8. Accounts, sharing and collaboration

- **Login**: email or Google.
- **Guest use**: a visitor can open the sample Trip and edit it in an anonymous browser session without logging in. On login or sign-up, the guest's Trips are added to the account (existing Trips are kept, nothing is overwritten). Clearing browser data before logging in loses guest data, and the save prompt says so.
- **Roles** (ADR 0003):

| Action | Owner | Editor | Viewer |
|---|---|---|---|
| Edit Events, Todos, Legs | yes | yes | no |
| See Todos and the Discard Pile | yes | yes | no |
| Delete the Trip | yes | no | no |
| Invite people, change sharing | yes | no | no |

- **Viewer**: opens a share link, read-only, no login required. Sees Days, the Map View and the Parking Lot. Contact fields (phone, email) of Events are visible. The Owner can turn the link off at any time.
- **Editor**: invited by email; must log in. The Owner can see and remove Editors.
- **Collaboration**: changes from one person appear promptly for others. Conflicts resolve per Event, with the last write winning.

## 9. Export

| Format | Content | Purpose |
|---|---|---|
| Document (openable in Google Docs) | Each Day's schedule with Event details; no Todos, no Discard Pile | Print or send to companions |
| Full backup (this app's format) | Everything: Todos, Parking Lot, Discard Pile; importing creates a new Trip | Clone or restore a Trip |
| Image | One image for the whole Trip, Days side by side, with Leg durations and travel-mode icons; no map | Sharing in chats |

## 10. Devices

- **Desktop**: Days shown side by side. Drag-and-drop everywhere: within a Day, between Days, and between holding areas and Days.
- **Phone**: one Day shown at a time, switched by tabs or swiping. Within a Day, Events can be dragged up and down and resized, and any time slot can be tapped to create an Event. Moving Events between a Day and a holding area, or between Days, is done through the Day and start-time fields. Holding areas appear as a bottom drawer.

## 11. Constraints

- **Google Maps cost control**: Legs are created by user action and recalculated only when their two locations or travel mode change; place search results and Leg durations are cached on the server per pair of points and mode; AI generation is rate-limited per user.
- **Collaboration limits**: v1 does not provide merge of simultaneous edits to one field.
- **Data safety**: deleting Todos along with an Event is irreversible after confirmation, so the confirmation must state the count.

## 12. Open items deferred to the design spec

Colors, spacing, typography, empty and error states, animation, and field length limits.
