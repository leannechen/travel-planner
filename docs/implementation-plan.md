# Implementation Plan

Product rules are in [`PRD.md`](./PRD.md); vocabulary in [`CONTEXT.md`](../CONTEXT.md); decisions in [`docs/adr/`](./adr/). This file orders the work and tracks status. It changes often; the PRD should not.

**Current step: 6 (kinds and Transport).** Steps 0 to 5 are done. The final design is in [`docs/design/`](./design/); a few designer fixes are pending and do not block step 0.

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
- [ ] **6. Kinds and Transport.** Four kinds with distinct looks (icon and color); kind switcher in the panel; Transport has departure and arrival times (arrival on a later day shows "+1") and a transport label. Booking links, contacts and locations come later. *Needs:* 4.
- [ ] **6b. Lodging.** Lodging spans nights and shows as a banner on each Day; inserting or deleting a Day adjusts a Lodging's nights (PRD §3.2), and reordering Days leaves it alone. Until the Backlog exists (step 8), a Day deletion that would leave a Lodging with no nights is refused. *Needs:* 6.
- [ ] **7. Description and contacts.** Markdown Description, phone and email, with preview. *Needs:* 4.

### Holding areas and Todos

- [ ] **8. Backlog and Archive.** Events without a start time; schedule through the Day and start-time fields; desktop drag between areas and Days. Deleting a Day that has Events becomes allowed: a confirmation dialog states how many Events move to the Backlog, with an Undo toast (design 13). *Needs:* 5.
- [ ] **9. Todos.** Trip Todos and Event Todos; deleting or archiving an Event deletes its Todos with the confirmation and count, "do not remind me again", and an undo window for deletion. *Needs:* 8.
- [ ] **10. Notes.** Floating Notes panel with Markdown, pinning and ordering by last edit. *Needs:* 1.

### Experience

- [ ] **11. Keyboard operation.** Selection model, single-key and modifier shortcuts, tooltips with shortcuts, `?` cheat sheet. *Needs:* 9, 10.
- [ ] **12. Interface language and theme.** English and Traditional Chinese, and light and dark themes, each with a switch at the bottom of the left sidebar ("..." menu on phone); terms from the design spec mapping. *Needs:* 11.
- [ ] **13. Phone layout.** One Day at a time, bottom drawers for Backlog, Archive and Todos, field-based moves across areas. *Needs:* 9.

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

## Next phase (not scheduled)

Offline read-only access; adding Events from the Map View.
