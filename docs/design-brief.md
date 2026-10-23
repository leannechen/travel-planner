# Design Brief — Travel Planner

A short, self-contained brief to hand to a design tool. Full detail is in `design-spec.md`, `PRD.md` and `CONTEXT.md`; attach those and the images in `docs/reference/` if the tool accepts files.

## What the product is

A web app for planning trips, alone or with travel companions. Users arrange attractions, meals, lodging and transport across numbered days on a time axis, keep undecided ideas in a backlog, see travel time between places, and view the plan on a map. It works on desktop and phone.

## Feel

Calm, dense and quick, like a calendar or time tracker (the reference screenshots are Toggl's calendar and Excalidraw sketches). Clicking a time creates something; dragging moves or resizes it. Information density is high, so a block must stay readable even when short.

## Terms to use in the interface

Trip, Day, Event (kinds: Attraction, Meal, Lodging, Transport event), Leg (travel between two Events), Backlog (ideas not yet scheduled), Archive (ideas given up on), Todo, Note, Description. Default language is English; Traditional Chinese is a switchable second language, so text must tolerate length differences.

## Screens to design

1. **Landing / first visit**: one clear call to action that opens a sample Trip with Events already spread across Days. No AI prompt field here. While editing as a guest, the top bar shows a "Log in to save your progress" button.
2. **Trip workspace, desktop**: Backlog and Archive panels on the left (collapsible); Days as side-by-side columns, each with a time axis; a Todos panel; a top bar with Trip title, Schedule/Map switch, Notes and collaborators; Share, Export, language and theme switches at the bottom of the left sidebar.
3. **Trip workspace, phone**: one Day at a time with a day switcher; Backlog, Archive and Todos as bottom drawers.
4. **Event block and Leg**: four visually distinct kinds (use icon as well as color); Lodging as a thin banner at the top of each Day it covers; overlapping Events side by side; Leg shown between two Events with travel-mode icon and duration; warning states for too-short gaps and for opening-hours conflicts.
5. **Event edit panel** (popover on desktop, bottom sheet on phone): kind and title, Day and start time, duration, place search, Markdown Description, contact, opening hours, image, Event Todos.
6. **Floating Notes panel**: opens from anywhere with a shortcut, new Note field focused, pinned Notes first, Markdown editing in place.
7. **Map View**: markers colored by Day, Day filter, gray markers for Backlog Events, clicking a marker opens the edit panel.
8. **Dialogs**: Share (link on/off, invite Editors by email), Export (full backup), Trip settings, confirmation when archiving or deleting an Event that has Todos (states the count), deletion toast with Undo.
9. ~~**Exported image**~~: dropped on 2026-10-23 with document export; the full backup is the only export (PRD §9).
10. **States**: empty Trip, empty Day, empty Backlog; loading; errors; Viewer (read-only) mode; limits reached.

## Interaction rules that shape the design

- Clicking any time on a Day's axis creates an Event there; Events have absolute start times and may overlap.
- Desktop: drag between Days, Backlog and Archive. Phone: drag and resize inside a Day only; moving between areas uses the Day and start-time fields in the edit panel.
- Nearly everything is keyboard-operable; every button's tooltip shows its shortcut, and `?` opens a shortcut sheet.
- Viewers see Days, Map and Backlog only; no Todos, Notes or Archive.

## Decisions left to the designer

Color palette (accessible, light and dark if feasible), typography, spacing and density, iconography, motion, and the time-snapping increment.
