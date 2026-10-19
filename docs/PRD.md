# Travel Planner — Product Requirements

Vocabulary is defined in [`CONTEXT.md`](../CONTEXT.md); terms capitalized here (Trip, Day, Event, Leg, ...) carry those meanings. Decisions with lasting consequences are recorded in [`docs/adr/`](./adr/).

## 1. Problem and audience

People who plan trips on a desktop or phone juggle places, restaurants, lodging and transport across scattered notes, maps and chats. They need one place to arrange these by day on a time axis, see how long it takes to get between them, keep undecided ideas aside, and plan together with travel companions.

**Target users**: people who plan and organize trips using a desktop or a phone.

**First-visit goal**: a new visitor should see the product's value within seconds. Opening a sample Trip creates an editable copy, without logging in, with Events already distributed across Days.

## 2. Scope

### 2.1 In scope for v1

1. Trip planning on a Day time axis (§3)
2. Holding areas: Backlog and Archive (§4)
3. Todos (§5)
4. Map View (§6)
5. AI-generated Trips (§7)
6. Accounts, sharing and lightweight collaboration (§8)
7. Export (§9)
8. Desktop and phone experiences (§10)
9. Notes (§5.1)
10. Keyboard operation and interface language (§13, §14)

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
- **Day order**: Days can be reordered. Day numbers always follow position (1..N) and dates always follow the start date by position, so reordering moves the Days' contents, not their numbers. Events inside a moved Day are unchanged, and opening-hours warnings are recalculated for the new dates.
  - Desktop: drag the handle on a Day's header. Phone: a Day menu with "Move earlier" and "Move later". Keyboard: select a Day header and use a shortcut to move it left or right.
- **Adding a Day**: a Day can be inserted at any position; later Days are renumbered.
- **Deleting a Day**: a confirmation states how many Events will move to the Backlog; after confirming, they move there (not to the Archive), so their Event Todos are kept and their Legs are removed.

### 3.2 Events

- An Event has a **kind**: Attraction, Meal, Lodging or Transport event. The four kinds must be visually distinguishable at a glance; the specific colors are decided in the design spec.
- Inside a Day, an Event has an absolute start time and a duration (ADR 0001). Events may overlap and are displayed side by side when they do. Editing an Event never moves another Event. **Lodging is the exception**: it has a check-in Day and a number of nights instead of a start time and duration.
- The user can click any time on a Day's time axis (for example 10:00 or 15:30) to create an Event there, and can drag Events up and down and resize them on desktop and on phone within a Day.
- In a holding area an Event has a duration (Lodging: nights) but no start time or Day.

**Event attributes by kind**

| Attribute | Attraction | Meal | Lodging | Transport event |
|---|---|---|---|---|
| Title (required) | yes | yes | yes | yes |
| Day | yes | yes | check-in Day | yes |
| Time | start time and duration | start time and duration | check-in time and check-out time, optional, display only | departure and arrival time |
| Location | one place | one place | one place | departure and destination, both optional |
| Nights | | | yes | |
| Opening hours (read-only, from Google) | yes | yes | | |
| Contact (phone, email, website) | yes | yes | yes | |
| Booking link | | optional | yes | yes |
| Transport label (flight, train, ferry, bus, other), sets the icon | | | | yes |
| Description (Markdown), preview image, Event Todos | yes | yes | yes | yes |

Only the title is required.

- **Location is optional for every kind.** A free-text idea such as "tempura place a friend recommended in Ginza" is valid. Events without a location are ignored by Legs and the Map View.
  - A location is chosen by searching for a place and picking a result. An Event keeps only the place's id; the name, address and coordinates are read from a server cache that is refreshed after 30 days (ADR 0007), because the provider's terms allow storing place ids but not the rest of its content. A place the provider no longer knows shows no data. The search is a fake list of places until a Google key is configured.
- **Opening hours** come from Google place data and are read-only: the user cannot edit them. They exist only while the Event has a location, are fetched from Google when needed (server-side cached, not stored with the Event), and are not part of the data kept when the kind changes. Google's terms for storing place data are checked at implementation time (plan steps 14 and 16).
- **Preview image** defaults to the Google place photo when the Event has a location; the user may upload a replacement. Without an image, the kind's icon is shown.
  - **Replace** uploads the user's own image. **Remove** means "no image for this Event": the Google photo is no longer shown and the kind's icon is used. If the Event has a location, the image area then offers "Use place photo" to bring the default back.
  - Changing the location swaps the default Google photo to the new place's photo, but never replaces an image the user uploaded.
  - Google's terms for place photos were checked in plan step 14: photos may not be stored, the author must be credited (the name, with the avatar and profile link when space allows, and a larger view may carry it for thumbnails), and the place must be reachable on Google Maps. They are stricter than §9 assumed, so Google photos are fetched only when shown, are never stored or backed up, and are left out of every export. The Image export shows only photos the user uploaded.
- **Lodging** appears as a thin banner at the top of each Day whose night it covers, and also on the check-out Day, labelled with the check-out time. It is the default start point for that Day's first Leg. Three nights from Day 1 cover Days 1 to 3 and check out on Day 4.
- **Lodging is tied to Day positions, not to the Days' contents.** Reordering Days never changes a Lodging; the user adjusts it themselves if needed, so there are no surprising side effects. Inserting or deleting a Day adjusts a Lodging like a range: inserting before its check-in Day shifts it, inserting inside it adds a night, inserting after it changes nothing; deleting a Day inside it removes a night, and a Lodging left with no nights moves to the Backlog.
- **Transport times**: the user enters departure and arrival time; the duration is derived and stored like any other Event's. An arrival on a later day shows "+1".

**Changing an Event's kind** never silently loses data:

- Fields both kinds have (title, Description, image, Todos, location, contact) are kept as they are.
- Fields the new kind does not have are hidden but their values are kept, and reappear if the user switches back. A short note names what is hidden (for example "Duration kept, hidden for Lodging"). No confirmation is needed. Opening hours are not user data and are never listed: Google supplies them again when the Event is an Attraction or Meal with a location.
- Fields with a natural counterpart are converted: Attraction to Transport turns the location into the departure place; Transport to Attraction turns it back and keeps the destination hidden; Attraction to Lodging turns the Day into the check-in Day, the start time into the check-in time and sets nights to 1, keeping the duration hidden; Lodging to Attraction does the reverse and restores the kept duration or a default.

### 3.3 Legs

- A Leg is created only when the user clicks the time slot between two adjacent Events (ADR 0002). The system never creates Legs on its own.
- Both Events need a location. Its duration is computed from the two locations using the Google Maps API; the user picks the travel mode (drive, public transit, walk). A Trip has a default travel mode, chosen at creation and changeable in Trip settings; each Leg can override it.
- A Day's Lodging can be the start point of a Leg to the first Event of that Day.
- If the gap between two Events is shorter than the Leg's duration, a conflict warning is shown. Nothing is moved automatically.

**Leg detail**: clicking an existing Leg opens a small popover (not the full Event panel) showing:

- the names of the two Events it connects (read-only);
- the travel mode, which the user can change;
- the estimated duration and the distance, computed from Google and read-only;
- the current gap between the two Events, emphasized only when it is too short;
- a link that opens the route in Google Maps;
- a delete action.

A Leg has no Description or notes. Public-transit route details (lines, transfers) are not shown in v1; the Google Maps link covers them.

**Leg lifecycle**

| Situation | Result |
|---|---|
| The two Events stop being adjacent (moved, or another Event inserted between) | Leg is removed |
| An Event's location changes | Leg duration is recalculated |
| An Event's location is cleared | Leg stays and shows "cannot calculate" |
| Either Event leaves the Day (Archive, Backlog, deleted) | Leg is removed |

### 3.4 Transport events

A Transport event is an Event the user creates for transport with its own character (ferry, scenic train). It has departure and arrival times, a transport label, a booking link and a Description, and may have departure and destination places. Legs connect the previous Event to its departure place and its destination to the next Event.

### 3.5 Opening-hours check

When a Trip has dates and an Attraction or Meal with a location (so Google opening hours are available) is placed in a Day, a warning is shown if the Event's time falls outside those hours. Without a location or without Google data, nothing is checked. Warnings never block the user.

## 4. Holding areas

- **Backlog**: Events still being considered. **Archive**: Events given up on. Neither belongs to any Day.
- An Event is scheduled by editing two fields: **Day** (Day 1..N, or "not scheduled") and **start time**. On desktop it can also be dragged between a holding area and a Day. On phone this is done only through the fields.
- Moving an Event between Days uses the same fields; on desktop it can also be dragged.
- An Event without a location can be scheduled; it simply cannot have Legs or appear on the Map View.
- Taking an Event back from the Archive does not restore its deleted Event Todos.

## 5. Todos

- A **Trip Todo** belongs to the whole Trip (for example "Request leave 3/21–3/24"). An **Event Todo** belongs to one Event (for example "Book the room" on a Lodging).
- When an Event is put in the Archive or deleted, its Event Todos are deleted.
  - If the Event has at least one Todo, a confirmation is shown first, stating how many Todos will be deleted, including those created by other people. The dialog offers "do not remind me again"; there is no setting to turn the reminder back on in v1.
  - If the Event has no Todos, the action proceeds without a prompt.
- Deleting an Event can be undone for a few seconds, restoring its Todos too. Moving an Event to the Archive has no undo.
- Todos have no assignee in v1.

### 5.1 Notes and Descriptions

- A **Note** is a standalone Markdown entry in the Trip's notes list, for quick drafts (for example "Day 1–3 Kyoto, Day 4–5 Osaka"). It never links to an Event or a Day and nothing happens automatically when it changes.
- The notes list belongs to a Trip. The Owner and Editors can read and write it; Viewers cannot see it.
- Notes are shown in a floating panel that can be opened from any screen with a keyboard shortcut. The panel shows one of three states at a time: a **new Note**, the **list** of Notes, or one **open Note**. Its toolbar has "+" (start a new Note), a list button and "×" (close; Esc does too); the button for the state the panel is already in is disabled. While a Note is open, the "+" and list buttons are replaced by a single back button (same icon-button style) that returns to the list.
  - The field of a new or open Note shows the Markdown text as typed; it has no Write and Preview tabs and no live formatting (unlike an Event's Description).
  - Notes autosave. An open Note shows "Saved". A new Note is not saved until something is typed, so an empty Note never appears in the list; a Note whose text is deleted is deleted when the user leaves it.
  - The list shows pinned Notes first, then the rest by most recent edit. A row's title is the first line of the Note. Clicking a row opens the Note. A row has a pin button and a delete button; deleting a Note can be undone for a few seconds, as for Events. There is no search in v1.
  - Closing and reopening the panel returns to what was open (a new Note, the list or a Note), kept for the browser session. Only the first open of a session starts a new Note, focused for typing.
  - On desktop the panel floats, its header is the drag handle, and it stays within the window. On phone it is a full-width bottom sheet.
- An Event's **Description** is a Markdown block holding that Event's details, like the body of a Trello card.
- Markdown checkboxes inside a Description are formatting only; they are not Todos, do not appear in the Todo list, and do not affect what happens when the Event is archived.

## 6. Map View

- Shows Event locations on a Google Map, colored by Day, with the ability to show one Day or all Days.
- Clicking a marker opens the same edit panel as the time-axis view.
- Backlog Events are shown with a gray marker by default, so the user can judge which Day they fit; this can be turned off.
- Events without a location do not appear.
- Within a Day, a dashed line connects markers in the order of the Day. It shows the Day's order only; it is not a route and not a Leg, and it can be turned off. A Transport event gets a marker at its departure place and one at its destination, joined by a thin line.
- The default and complete editing experience stays in the time-axis view. Adding Events from the map is a next-phase feature.

## 7. AI-generated Trips

- From a free-text prompt such as "Kanazawa, Japan, 5 days", the system creates a new Trip with Events on Days.
- Preferences are part of the free text (for example "likes hot springs, relaxed pace"); there are no structured fields in v1.
- Generated Events use real Google Maps places and are scheduled with times. The user edits the result; they may discard it and generate again.
- AI is limited to creating new Trips and does not read existing Trip content.
- Only logged-in users can generate a Trip with AI; usage is limited per user per day. Guests cannot use AI, and the landing page has no prompt field. Logged-in users start generation from the New Trip action in their Trip list. The sample Trip is pre-built and does not call AI.

## 8. Accounts, sharing and collaboration

- **Login**: email or Google, on a login page hosted by Auth0 (ADR 0006). One page serves both login and sign-up. Every entry point (the Landing page link, the guest save button, Share, Export, New Trip) goes straight to that page, with no extra prompt in between.
- **Hosted page limits**: only branding (logo, colors, font, background) can be customized. The page cannot follow the in-app theme switch, so it follows the system theme. The interface language is passed to it where Auth0 supports that (to be verified at plan step 18).
- **After login**: a user with guest Trips sees a confirmation that they were added to the account and lands in the Trip; a user without lands on the Trip list. If login fails or is cancelled, the user returns to where they were with a dismissible message.
- **Account menu**: top right, shows the user's email, "My Trips" and "Log out". There is no profile or preferences screen. Logging out returns to the Landing page.
- **Session expiry**: if the session expires while editing, a banner asks the user to log in again; the Trip stays on screen read-only until then, and unsaved edits are not discarded silently.
- **Guest use**: a visitor can open the sample Trip (but cannot use AI generation) and edit it in an anonymous browser session without logging in. While a guest is not logged in, the workspace shows a "Log in to save your progress" button (wording to be confirmed). On login or sign-up, the guest's Trips are added to the account (existing Trips are kept, nothing is overwritten). Clearing browser data before logging in loses guest data; the guest save button explains this in its tooltip and, on phone, in the banner text.
- **Roles** (ADR 0003):

| Action | Owner | Editor | Viewer |
|---|---|---|---|
| Edit Events, Todos, Legs, Notes | yes | yes | no |
| See Todos, Notes and the Archive | yes | yes | no |
| Delete the Trip | yes | no | no |
| Invite people, change sharing | yes | no | no |

- **Viewer**: opens a share link, read-only, no login required. Viewers cannot export. Sees Days, the Map View and the Backlog. Contact fields (phone, email) of Events are visible. The Owner can turn the link off at any time.
- **Editor**: invited by email; must log in. Following the invitation link while logged out shows who invited them and to which Trip, with Log in and Sign up; afterwards they land in the Trip. The Owner can see and remove Editors.
- **Collaboration**: changes from one person appear promptly for others. Conflicts resolve per Event, with the last write winning.

### 8.1 Trip management

- A user has a list of their Trips and a separate list of Trips shared with them (as Editor). The list is a collapsible sidebar on desktop and a full screen on phone, opened from the Trip title; switching Trips loses no edits, since everything autosaves.
- **New Trip**: title, optional start date, default travel mode. Create with AI is offered first for logged-in users.
- Trip actions: rename, Trip settings, export, share, and delete (Owner only). Deleting asks the Owner to type the Trip title, and states what is lost: its Events, Backlog, Archive, Todos and Notes, and that Editors and the share link lose access.
- **Import backup** creates a new Trip from a full-backup file (§9).
- Search, folders, favorites and reordering Trips are not in v1.

## 9. Export

| Format | Content | Purpose |
|---|---|---|
| Document (openable in Google Docs) | Each Day's schedule with Event details; no Todos, no Archive, no images | Print or send to companions |
| Full backup (this app's format) | Everything: Todos, Notes, Backlog, Archive, and images the user uploaded (not Google photos); an Event's place is kept as its place id, so importing needs the place provider to show it; importing creates a new Trip | Clone or restore a Trip |
| Image | One image for the whole Trip, Days side by side, with Leg durations and travel-mode icons and Event images where Google's terms allow; no map | Sharing in chats |

## 10. Devices

- **Desktop**: Days shown side by side. Drag-and-drop everywhere: within a Day, between Days, and between holding areas and Days.
- **Phone**: one Day shown at a time, switched by tabs or swiping. Within a Day, Events can be dragged up and down and resized, and any time slot can be tapped to create an Event. Moving Events between a Day and a holding area, or between Days, is done through the Day and start-time fields. Holding areas appear as a bottom drawer.

## 11. Constraints

- **Google Maps cost control**: Legs are created by user action and recalculated only when their two locations or travel mode change; place search results and Leg durations are cached on the server per pair of points and mode; AI generation is limited to logged-in users and rate-limited per user.
- **Collaboration limits**: v1 does not provide merge of simultaneous edits to one field.
- **Data safety**: deleting Todos along with an Event is irreversible after confirmation, so the confirmation must state the count.

## 12. Terms in the interface

The product uses the terms in `CONTEXT.md`. In the Traditional Chinese interface, Backlog is shown as 未決區 and Archive as 放棄區; the design spec holds the full term mapping. The Archive wording must make clear that an archived Event's Todos are deleted.

## 13. Keyboard operation

- Most actions can be done from the keyboard: create an Event, select an Event, open it, move through Events, delete, cancel.
- There is a notion of a selected Event: arrow keys move the selection, Enter opens it for editing, Delete removes it (following the confirmation rules in §5), Esc clears the selection.
- Frequent actions use single keys, active only when no text field is focused. App-wide actions (such as opening the notes panel) use modifier combinations.
- The shortcuts: arrow keys select, Enter edits, Delete removes, Esc clears, N / B create an Event on the selected Event's Day / in the Backlog, Shift+arrows change time or Day; Ctrl+Alt+N opens Notes (Alt+Shift combinations clash with the Windows input-language switch).
- Pressing `?` shows a shortcut cheat sheet. Every button's tooltip also shows its shortcut.

## 14. Interface language and theme

- The default interface language is English; the user can switch to Traditional Chinese.
- The switch applies to interface text. AI generation uses the current interface language. Fixed labels in exports (such as "Day 1" and date formats) follow the interface language. Text the user typed is never translated.
- The language switch and the theme switch (light or dark) sit at the bottom of the left sidebar on desktop, together with Share and Export, and in the "..." menu on phone; on pages without the sidebar (Landing, invitation) they sit in the top right; there is no separate preferences screen. The theme follows the system setting by default and the user's choice overrides it.
- Logged-in users keep the setting on their account; guests keep it in the browser. A Viewer sees the interface in the language of their own browser, defaulting to English.

## 15. Open items deferred to the design spec

Colors, spacing, typography, empty and error states, animation, and field length limits.
