# Implementation Plan

Product rules are in [`PRD.md`](./PRD.md); vocabulary in [`CONTEXT.md`](../CONTEXT.md); decisions in [`docs/adr/`](./adr/). This file orders the work and tracks status. It changes often; the PRD should not.

**Current step: 12 (Interface language and theme).** Steps 0 to 11 are done. The final design is in [`docs/design/`](./design/); a few designer fixes are pending and do not block step 0.

## Working agreement

- Work in thin vertical slices: each step delivers one visible behavior across data, logic and UI, and leaves the system working.
- One commit per step; the commit message starts with the step number, for example `step 3: show Events on the time axis`.
- Rules (Leg lifecycle, overlap layout, Todo deletion) are written test-first with Vitest, before the UI that uses them.
- External services (Google Maps, Claude, Auth0) start behind a small interface with a fake implementation; the real one is its own step.
- Everything committed is in English.
- Before each commit, `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass.
- At the end of each step, say how to check the new behavior in the browser.

## Stack

React, TypeScript and Vite (web); Node.js, TypeScript and Express 5 (API); PostgreSQL with Drizzle ORM; Zod schemas in a shared package; dnd kit; Auth0; Google Maps Platform; Claude API; Vitest; Docker on fly.io. Layout: npm workspaces `apps/web`, `apps/api`, `packages/shared`.

## Steps

Each step lists what it needs from earlier steps and when it is done.

### Foundation

- [x] **0. Tooling baseline.** Workspaces, TypeScript, lint, Vitest, local Postgres via Docker Compose, CI that runs tests. *Done when:* `npm test` passes on an empty test and the web and API apps start.
- [x] **1. Walking skeleton.** Create a Trip with Day 1 and add an Event with only a title; it persists and is listed. A fixed development user owns the Trip. *Needs:* 0. *Done when:* reloading the page still shows the Event.
- [x] **2. Multiple Days.** Insert, delete (moving Events to the Backlog once step 8 exists; until then deletion is only allowed for an empty Day, and the last Day cannot be deleted) and reorder Days; Days are shown side by side. Reordering uses Move earlier / Move later buttons; the drag handle and keyboard shortcut come later (step 5 and step 11). *Needs:* 1.

### Schedule

- [x] **3. Time model.** Events get a start time and duration and are drawn on the time axis; overlapping Events share width (pure layout logic with tests). The axis shows 08:00 to 22:00 and widens to cover Events; an Event running past midnight is cut off there. *Needs:* 2.
- [x] **4. Create and edit on the axis.** Click a time (rounded down to 15 minutes) to create an Event there; edit title, Day, start time and duration in the side edit panel, which autosaves a field when it is left. A new Event is saved once it has a title. Each Day also has an "Add event" button for keyboard users. Deleting an Event waits for step 9. *Needs:* 3.
- [x] **5. Drag and resize (desktop).** Move and resize Events within a Day with snapping to 15 minutes (minimum 15 minutes); nothing else moves. Move uses dnd kit (`@dnd-kit/react`, pinned), resize uses the handles on the selected card; dragging does not select an Event or open the panel. Dragging across Days is step 8. *Needs:* 4. (ADR 0001)
- [x] **6. Kinds and Transport.** Four kinds with distinct looks (icon and color); kind switcher in the panel; Transport has departure and arrival times (arrival on a later day shows "+1") and a transport label. Booking links, contacts and locations come later. *Needs:* 4.
- [x] **6b. Lodging.** Lodging spans nights and shows as a banner on each Day; inserting or deleting a Day adjusts a Lodging's nights (PRD §3.2), and reordering Days leaves it alone. Until the Backlog exists (step 8), a Day deletion that would leave a Lodging with no nights is refused. *Needs:* 6.
- [x] **7. Description and contacts.** Markdown Description edited with live formatting (Tiptap, stored as plain Markdown), phone, email, website and a booking link, each shown for the kinds that have it (PRD §3.2). *Needs:* 4.

### Holding areas and Todos

- [x] **8. Backlog and Archive.** Events without a start time; schedule through the Day and start-time fields; desktop drag between areas and Days. Deleting a Day that has Events becomes allowed: a confirmation dialog states how many Events move to the Backlog, with an Undo toast (design 13). An empty Day is deleted at once, also with the toast. The Todo and Leg lines of the dialog come with steps 9 and 15. *Needs:* 5.
- [x] **9. Todos.** Trip Todos and Event Todos; deleting or archiving an Event deletes its Todos with the confirmation and count, "do not remind me again", and an undo window for deletion. Deleting an Event (from the edit panel) arrives here. Todos can be added, ticked and deleted; renaming a Todo has an API but no UI yet. "Do not remind me again" is kept in the browser until accounts exist (step 18). *Needs:* 8.
- [x] **10. Notes.** Floating Notes panel following design 42: one of three states at a time (new Note, list, open Note), a plain Markdown field (no live formatting), autosave with "Saved", pinning, ordering by last edit, and deleting a Note with an Undo toast. A Note emptied of text is deleted when left. The panel opens from a Notes button on each Trip and with Ctrl+Alt+N (settled in step 11). It is draggable (position kept in the browser), reopens on what was open (kept for the session), and is a bottom sheet on narrow screens (refined in step 13). *Needs:* 1.

### Experience

- [x] **11. Keyboard operation.** Arrow keys move the selection (Backlog, Archive, then Days left to right); Enter edits, Delete removes (with the Todo confirmation), Esc clears; N and B create an Event; Shift+arrows change the time (15 minutes) or the Day; `?` opens the cheat sheet; Notes opens with Ctrl+Alt+N (Alt+Shift switches the input language on Windows); tooltips show shortcuts. Selecting a Day header and moving it from the keyboard is not done: the Move earlier / later buttons already work with the keyboard. *Needs:* 9, 10.
- [x] **12. Interface language and theme.** English and Traditional Chinese, and light, dark or system themes, each with a switch at the bottom of a slim left sidebar (a "..." button on phone); terms from the design spec mapping; the choice is kept in the browser until accounts exist (step 18). A first visit uses Chinese for a Chinese browser. Texts live in `apps/web/src/messages.ts` (a test checks both languages have the same keys). Not translated: messages from the server, from the save rules in the shared package and the "Request failed" text of the API client, and the Markdown editor. The sidebar holds only these switches so far; the full sidebar and the rest of the visual design are not part of this step. *Needs:* 11.
- [ ] **12b. High-fidelity desktop styling.** Apply the final design (`docs/design/`, tokens in `source/hf.css`) to what exists: colors and both themes from the tokens, Inter, Nunito and Noto Sans TC, 4-pt spacing, radius and shadow, button and field styles, Event cards and kind icons, Lodging banners, the top bar (Trip title, Notes with its shortcut) and the desktop layout with the Backlog and Archive in the left sidebar, the Todos panel on the right, the Event panel, dialogs, toast, Notes panel and the shortcut sheet, in English and Traditional Chinese. Parts of the design whose features come later (Share, Export, Map switch, collaborators, account, Legs, photos, opening hours) are left out. Check against the PNGs for screens 01, 04, 07, 10, 13, 17, 19, 20, 29 to 33 and 42 and their dark versions. No behavior changes. *Needs:* 12.
- [ ] **13. Phone layout.** One Day at a time, bottom drawers for Backlog, Archive and Todos, field-based moves across areas, styled to the final design. *Needs:* 9, 12b.

### Places and travel

- [ ] **14. Places.** Attach a location to an Event through a place-search interface, first with a fake provider, then Google. *Needs:* 4. Check Google's terms for place photos here and adjust PRD §3.2 and §9 if needed. (Opening hours display and warnings in step 16.)
- [ ] **15. Legs.** Click the slot between two Events to create a Leg; travel mode choice; lifecycle rules from PRD §3.3 with tests; first with a fake travel-time provider, then Google, with server-side caching. *Needs:* 5, 14. (ADR 0002)
- [ ] **16. Opening hours.** Read-only opening hours fetched from Google place data (server-side cache), shown in the panel, warnings when a Trip has dates. No manual editing. Check Google's terms for storing place data. *Needs:* 14.
- [ ] **17. Map View.** Markers colored by Day, Day filter, gray Backlog markers, marker opens the edit panel. *Needs:* 14.

### Accounts and collaboration

- [ ] **18. Sign-in.** Auth0 login, API token validation, `User` record, ownership; account menu, guest session and merge on login, session-expiry banner with a read-only Trip, pass the interface language to the hosted page, check how the hosted page follows the theme. *Needs:* 1. (ADR 0006)
- [ ] **19. Viewer link.** Read-only share link that can be turned off; Viewers do not see Todos, Notes or the Archive. *Needs:* 18.
- [ ] **20. Editors.** Invite by email, invitation landing page for logged-out invitees, roles and permissions per PRD §8. *Needs:* 19.
- [ ] **21. Live collaboration.** WebSocket updates, last write wins per Event, highlight of others' changes. *Needs:* 20. (ADR 0003)

### Onboarding, AI and export

- [ ] **22. Sample Trip.** Landing page with only "Open a sample Trip" and log in, an editable copy for a guest, and a "Log in to save your progress" button. *Needs:* 18.
- [ ] **23. AI generation.** Prompt (from the New Trip action, logged-in users only) to a new Trip with real places and times, daily limit. *Needs:* 14, 15, 18.
- [ ] **24. Export.** Document, backup with import, and whole-Trip image. *Needs:* 15.

### Trips

- [ ] **25. Trip management.** Trip list and Shared-with-me, New Trip, rename, delete with typed confirmation, import backup, switching Trips. *Needs:* 18, 20, 24. (PRD §8.1)

### Release

- [ ] **26. Photo attribution.** Add author attribution for the placeholder photos, once all features are done.
- [ ] **27. Deploy.** Docker image on fly.io, production Postgres, environment configuration. *Needs:* 18.

## Known issues (not scheduled)

- **Todo counts can be stale.** The deletion dialog counts Todos from what the browser has loaded; a Todo added by someone else a moment before is deleted without being counted. Revisit with live collaboration (step 21).

- **Drag shows the old time.** While an Event is dragged (for example from Day 1 09:00 towards Day 2 10:00), the card keeps its old time until it is dropped, which can suggest the target is wrong. Show the time of the current drop position on the card during the drag. Best done together with a browser check of dragging, which the automated browser could not do in step 8.

- **Keyboard time and Day changes are unreliable.** Shift+arrow (move 15 minutes or to another Day) and Delete on the selected Event often do nothing, probably because the focus is in the Event panel's title field after an Event is selected with the mouse, where single keys are off by design. Not important; decide how focus should work after selecting an Event, then revisit.

## Next phase (not scheduled)

Offline read-only access; adding Events from the Map View.
