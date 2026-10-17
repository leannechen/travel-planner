# Travel Planner — Design Spec

Hand-off for visual and interaction design. Product rules live in [`PRD.md`](./PRD.md); vocabulary in [`CONTEXT.md`](../CONTEXT.md). This document describes what the screens look like and how they behave, and does not restate rules.

Reference material in `docs/reference/`: `excalidraw-design-draft.png` (Day layout and Event creation dialog), `toggle-screenshot-list.png` and `toggle-screenshot-detail.png` (time-axis interaction and the Event detail popover), `google-map-list.png` (the kind of map-with-list view Map View should feel like).

## 1. Design principles

- The time-axis view is the home of the product. Everything else supports it.
- Interactions should feel like a calendar or time tracker: click a time to create, drag to move, drag an edge to resize.
- Information density is high; an Event block must stay readable at short durations.

## 2. Screens

### 2.1 Landing and first visit
- One clear call to action: open a sample Trip. It creates an editable copy with Events already spread across Days, with no login.
- Secondary action: log in. There is no prompt field for AI generation on the landing page; logged-in users generate from the New Trip action in their Trip list.
- In a guest's workspace the top bar shows a "Log in to save your progress" button (wording to be confirmed) until they log in.

### 2.1a Sign-in and sign-up
- No prompt before login: entry points go directly to the Auth0 page. The guest save button carries the note about losing data when browser data is cleared.
- Themed Auth0 hosted page (login and sign-up tabs, Google button, error state); only branding can be customized.
- After login: guest Trip added, Trip list, and failure states.
- Account menu in the top right (logged-in and logged-out versions), logout result, session-expired banner, and the invited-Editor landing page.

### 2.2 Trip workspace (desktop)
Layout, left to right:
- **Backlog** panel and **Archive** panel (collapsible).
- **Days**: columns side by side, each with a header (drag handle for reordering, Day number, optional date, menu with move, insert and delete), a time axis, and Event blocks. Horizontal scroll when many Days.
- **Todos** panel (Trip Todos, with Event Todos grouped under their Event).
- A top bar: Trip title, view switch (Schedule / Map), Notes, Share, Export, language and theme switches (top right), collaborators.
- A floating **Notes panel**, opened from anywhere with a keyboard shortcut: a field for a new Note on top (focused on open), then pinned Notes, then the rest by most recent edit. Markdown is edited in place.

### 2.3 Trip workspace (phone)
- One Day at a time, with a Day switcher (tabs or swipe) and the date when set. The Day menu has "Move earlier", "Move later", insert and delete; reordering is not done by dragging on phone.
- Holding areas and Todos in bottom drawers.
- Event creation: tap a time slot. Moving between a Day and a holding area, or between Days: edit the Day and start-time fields in the Event panel.

### 2.4 Map View
- Full-width map, markers colored per Day, a Day filter, a toggle for gray Backlog markers.
- Clicking a marker opens the same Event edit panel as the schedule.

### 2.5 Share, Export and Settings dialogs
- Share: link on/off, copy link, invite Editors by email, list and remove Editors.
- Export: three options (document, backup, image) with a short description each.
- Trip settings: title, dates, default travel mode, delete Trip. Language is not here; it is a top-right switch.

## 3. Components

### 3.1 Event block
- Image: shown in the block when it is tall enough (thumbnail on the left, title, time and place on the right); it is the place's Google photo by default, the user's upload when replaced, or the kind's icon when there is none.
- Variants for the four kinds, distinguishable by color and icon (palette to be chosen by design; it must work for color-blind users, so also rely on the icon).
- Content by available height: title only (short), title and time (medium), image, title, time and place (tall).
- Lodging renders as a thin banner at the top of its Day.
- Overlapping Events share the column width side by side.
- States: default, hover, selected, being dragged, warning (conflict or outside opening hours), "cannot calculate" (Leg).

### 3.2 Leg
- A distinct, lighter block between two Events, showing travel-mode icon and duration.
- Shown only after the user clicks the slot between the two Events; the click opens a small chooser for the travel mode.
- Warning state when the gap is too short.
- Clicking an existing Leg opens a small popover (a bottom sheet on phone) with: the two Event names (read-only), travel mode selector, duration and distance (read-only), the current gap (emphasized only when too short), "Open in Google Maps", and delete. No Description or notes field, and no transit route details.

### 3.3 Event edit panel
- A side panel on desktop (Expand turns it into a modal), a bottom sheet on phone.
- Fields depend on the kind (PRD §3.2). Attraction and Meal share one layout; Lodging replaces start time and duration with check-in Day, nights and check-in and check-out times; Transport has departure and destination places, departure and arrival times (with "+1" when arriving on a later day), a transport label and a booking link. Design all four variants.
- The image area has Replace and Remove. After Remove, it shows the kind's icon and, if the Event has a location, a "Use place photo" action. Common fields: kind and title; Day and time; location (Google place search); Description (Markdown); contact (phone, email, website, collapsed by default); opening hours (Attraction, Meal); image; Event Todos.
- Switching the kind keeps hidden values and shows a short note naming what is hidden; design that transition (PRD §3.2).
- Creation dialog follows the draft: kind chip, place input, confirm button.

### 3.4 Confirmation dialogs
- Delete or discard an Event with Todos: states the count, including Todos created by others; "do not remind me again" option.
- Deletion toast with an Undo action for a few seconds.

### 3.5 Holding-area cards
- Compact Event cards showing kind, title and duration; a "schedule" action opens the Day and start-time fields.

## 4. Interaction details

- **Create**: click a time on a Day's axis; the new Event starts at that time (snap to a small increment, such as 15 minutes).
- **Move and resize**: drag the block or its edges; snap; nothing else moves.
- **Desktop drag between areas**: Events can be dragged between a Day, another Day, Backlog and Archive, with a clear drop target highlight.
- **Phone**: within a Day, drag and resize are available; across areas, only the fields.
- **Collaboration**: other people's changes appear without reload; show who is online and briefly highlight an Event changed by someone else.
- **Viewer mode**: same layout without edit affordances, no Todos or Archive.

## 5. Keyboard and language

- Shortcuts follow PRD §13. Show the shortcut in each control's tooltip and provide a cheat sheet on `?`. Single-key shortcuts must not fire while a text field is focused.
- The Description editor is a Markdown editor with preview; the same applies to Notes.
- Interface language switch in the top bar and in settings. Text must tolerate length differences between English and Traditional Chinese.

| English | Traditional Chinese |
|---|---|
| Trip | 旅程 |
| Day | 第 N 天 |
| Event | 事件 |
| Attraction | 景點 |
| Meal | 餐廳 |
| Lodging | 住宿 |
| Transport event | 交通 |
| Leg | 移動 |
| Backlog | 未決區 |
| Archive | 放棄區 |
| Todo | 待辦 |
| Note | 筆記 |
| Description | 說明 |
| Owner / Editor / Viewer | 擁有者 / 編輯者 / 檢視者 |

## 6. States to design

- Empty Trip, empty Day, empty holding area.
- Loading (AI generation, Leg calculation, map).
- Errors: place not found, calculation failed, share link off, no permission, offline (a clear message; offline reading is a next-phase feature).
- Limits reached: AI daily limit.

## 7. Export visuals

- **Image**: a poster-style layout with Days side by side, Event blocks in their kind colors, Leg duration and mode between them, Trip title and date range in a header. Must remain legible when exported with many Days.
- **Document**: simple, printable, one section per Day.

## 8. Final design

The final design is in [`docs/design/`](./design/) (`README.md` lists all 32 screens). Where it differs from this document, the design wins, except for the points listed in the PRD.

- Tokens: `docs/design/source/hf.css`. Kind colors: Attraction blue, Transport green, Meal orange, Lodging purple, each with an icon. Fonts: Inter, Nunito, Noto Sans TC. 4-pt spacing. Time snapping: 15 minutes. Light and dark themes.
- The language and theme switches sit in the top right.
- Placeholder photos come from Unsplash; author attribution is added at the end of the project (plan step 26).
