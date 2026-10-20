# Designer fixes

Changes the design files need. Update the `source/` files and re-export the PNGs, then tick the item.

## Event panel: kind dropdown and Save / Cancel footer (designed 2026-10-20)

The panel saves on the Save button (PRD §3.2), so the earlier autosave look is gone. Developers: build from #46, and see #03, #04, #05, #07, #08, #09 for the panel in place.

- [x] Kind chips replaced by a dropdown tinted with the kind's color, icon and name; the selected row uses the same tint for border and background (#46, #04, #05, #07, #09; phone #03, #08).
- [x] Footer: `⋯` menu on the left, Cancel and Save on the right, Save is the only filled button. No "Saved" indicator, no "Saved automatically" (#46, all panels).
- [x] `⋯` menu by state: scheduled Event (Move to Backlog, Archive, Delete), Backlog Event (Archive, Delete), Archived Event (Restore to Backlog, Delete) (#46).
- [x] New Event: no `⋯`, Save reads "Add Event". Nothing changed yet: Cancel reads "Close". Phone: no Cancel, `⋯` plus a full-width Save (#46, #03, #08).
- [x] Side panel keeps its footer in view: the body is clipped with a fade (it scrolls in the app) and the footer stays at the bottom (#04, #46).
- [x] PRD §3.2 and §4 now describe the `⋯` menu, including Move to Backlog and Restore to Backlog (2026-10-20).

## Opening hours are read-only (decided 2026-10-18)

Opening hours come from Google and the user cannot edit them (PRD §3.2). The field must look read-only (plain text, no dropdown chevron), and the kind-switch note must not mention opening hours.

- [x] `PanelSwitch.dc.html` (#09): remove "opening hours" from the notes ("Duration and opening hours kept, hidden for Lodging" becomes "Duration kept, hidden for Lodging"; same for the Transport example text).
- [x] `EventPanelSide.dc.html` (#04), `PanelKinds.dc.html` (#07), `MapView.dc.html` (#06): the Opening hours field is drawn as an input with a chevron; draw it as read-only text with a "from Google" hint.
- [x] `Viewer.dc.html` (#18), `EventPanel*.dc.html`, `PanelKindsPhone.dc.html`: check the same.
- [x] `DSComponents.dc.html` (#30): no change expected (the warning style stays).

## Opening hours on request (PRD §3.5, plan step 16; designed 2026-10-19)

Opening hours are fetched only when the user presses a button. Everything the plan listed as "not designed yet" is now drawn in `OpeningHours.dc.html` (#44). Developers: build from #44, and see #04, #05, #07 (desktop) and #03, #08 (phone) for the section in place.

- [x] Section after Contact, before Image: button "Get opening hours from Google" (off), loading, one line when the same every day, the Event's weekday with a "Whole week" toggle, "from Google" beside the hours, "Remove opening hours" action (#44 states 1 to 5, 11, 12).
- [x] Notes: no start date (week shown plus a note that dates are needed), Google has no hours (#44 states 6, 7).
- [x] Read-only panels (Map View #06, Viewer #18): hours and conflict text, no button, no Remove action (#44 state 8).
- [x] Section not shown for Lodging, Transport, or an Event without a place (#44 state 10).
- [x] One general conflict text "Opening hours may conflict": amber label and amber border on the card (all boards that showed "Closes at 18:00"), the same text beside the hours in the panel, dark theme included (#44 state 9 and cards). No detail, no dismissal.
- [x] Proposed Traditional Chinese wording is on #44. Not drawn: hours that fail to fetch (the spec shows no hours and no label).

## Phone: account and Trip menus (designed 2026-10-20)

Language, theme, log out, Share and Export were spread over several phone screens. #47 puts them in two places. Developers: build from #47; desktop is unchanged.

- [x] Account button (round avatar; person icon for guest and Viewer) opens a bottom sheet: Language, Theme, Log out. Guest: "Log in to save your progress", Language, Theme.
- [x] Trip `⋯` button opens a bottom sheet: Share…, Export…, Trip settings…. Share is no longer in the top bar, so the Trip title keeps about 230px.
- [x] By role: Owner has all three; Editor has Export and Trip settings (no Share); Viewer has no `⋯` and no Notes, with a "Read only" chip; guest sees Share and Export marked "Needs login".
- [x] No "My Trips" row on phone: tapping the Trip title opens the Trip list. Desktop keeps My Trips in the account menu.
- [ ] Open: a logged-in Viewer's title has no ▾, so there is no way to the Trip list on phone.
- [x] PRD §8 and §14 updated.

## Earlier list

- [ ] Language, theme, Share and Export placement at the bottom of the left sidebar (the full earlier list was only in chat; add the other items here).
