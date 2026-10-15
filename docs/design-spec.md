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
- Secondary actions: generate a Trip from a prompt, log in.

### 2.2 Trip workspace (desktop)
Layout, left to right:
- **Parking Lot** panel and **Discard Pile** panel (collapsible).
- **Days**: columns side by side, each with a header (Day number, optional date), a time axis, and Event blocks. Horizontal scroll when many Days.
- **Todos** panel (Trip Todos, with Event Todos grouped under their Event).
- A top bar: Trip title, view switch (Schedule / Map), Share, Export, collaborators.

### 2.3 Trip workspace (phone)
- One Day at a time, with a Day switcher (tabs or swipe) and the date when set.
- Holding areas and Todos in bottom drawers.
- Event creation: tap a time slot. Moving between a Day and a holding area, or between Days: edit the Day and start-time fields in the Event panel.

### 2.4 Map View
- Full-width map, markers colored per Day, a Day filter, a toggle for gray Parking Lot markers.
- Clicking a marker opens the same Event edit panel as the schedule.

### 2.5 Share, Export and Settings dialogs
- Share: link on/off, copy link, invite Editors by email, list and remove Editors.
- Export: three options (document, backup, image) with a short description each.
- Trip settings: dates, default travel mode.

## 3. Components

### 3.1 Event block
- Variants for the four kinds, distinguishable by color and icon (palette to be chosen by design; it must work for color-blind users, so also rely on the icon).
- Content by available height: title only (short), title and time (medium), image, title, time and place (tall).
- Lodging renders as a thin banner at the top of its Day.
- Overlapping Events share the column width side by side.
- States: default, hover, selected, being dragged, warning (conflict or outside opening hours), "cannot calculate" (Leg).

### 3.2 Leg
- A distinct, lighter block between two Events, showing travel-mode icon and duration.
- Shown only after the user clicks the slot between the two Events; the click opens a small chooser for the travel mode.
- Warning state when the gap is too short.

### 3.3 Event edit panel
- A popover on desktop, a bottom sheet on phone.
- Fields grouped: kind and title; Day and start time; duration; location (Google place search); notes; contact; opening hours; image; Event Todos.
- Creation dialog follows the draft: kind chip, place input, confirm button.

### 3.4 Confirmation dialogs
- Delete or discard an Event with Todos: states the count, including Todos created by others; "do not remind me again" option.
- Deletion toast with an Undo action for a few seconds.

### 3.5 Holding-area cards
- Compact Event cards showing kind, title and duration; a "schedule" action opens the Day and start-time fields.

## 4. Interaction details

- **Create**: click a time on a Day's axis; the new Event starts at that time (snap to a small increment, such as 15 minutes).
- **Move and resize**: drag the block or its edges; snap; nothing else moves.
- **Desktop drag between areas**: Events can be dragged between a Day, another Day, Parking Lot and Discard Pile, with a clear drop target highlight.
- **Phone**: within a Day, drag and resize are available; across areas, only the fields.
- **Collaboration**: other people's changes appear without reload; show who is online and briefly highlight an Event changed by someone else.
- **Viewer mode**: same layout without edit affordances, no Todos or Discard Pile.

## 5. States to design

- Empty Trip, empty Day, empty holding area.
- Loading (AI generation, Leg calculation, map).
- Errors: place not found, calculation failed, share link off, no permission, offline (a clear message; offline reading is a next-phase feature).
- Limits reached: AI daily limit.

## 6. Export visuals

- **Image**: a poster-style layout with Days side by side, Event blocks in their kind colors, Leg duration and mode between them, Trip title and date range in a header. Must remain legible when exported with many Days.
- **Document**: simple, printable, one section per Day.

## 7. Open design decisions

Palette, typography, density, iconography, animation, and the exact snapping increment.
