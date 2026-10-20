# Travel Planner: high-fidelity design (final)

This folder is the **final** design for Travel Planner. It replaces the earlier wireframes. If anything here disagrees with another copy, this folder wins.

- **Design name:** Travel Planner — High Fidelity
- **Date:** 2026-10-17
- **Fidelity:** all 47 screens are high fidelity. There are no wireframe-only screens left. Some dialog backdrops are still simplified (see the "Design notes" asides inside the screens).
- **Order and names:** The two-digit number in each image name is the screen order.

## Layout

```
design/
  README.md
  png/       one image per screen at 2x resolution, numbered in design order
  source/    original HTML, CSS and canvas.json
    hf.css          shared stylesheet: color tokens (light + dark), type, spacing, radius, shadow, components
    canvas.json     board sizes, positions and the official order
    *.dc.html       one file per screen (open directly in a browser)
    assets/         photos used by Landing and the Event image examples
```

## Images

All images in `png/` are exported at **2x** (twice the CSS pixel width and height). Divide pixel measurements by 2 to get CSS pixels. `16-landing`, `26-event-image`, `36-login-hosted`, `39-logout` and `41-invite-editor` are WebP instead of PNG to keep the repo small because they contain large photos. Screen sizes in the table below are in CSS pixels.

## Reading values from the source

- **Colors, type, spacing, radius, shadow:** `source/hf.css` (`:root` tokens, with a dark-theme override). `DSTokens.dc.html` shows them visually.
- **Components and states:** `DSComponents.dc.html` and `DSOverlays.dc.html`. Real markup is in each screen file, using the classes from `hf.css`.
- **Page size:** each screen's width and height are in `canvas.json` (`boards`).
- The `.dc.html` files open as plain pages. The `support.js` script they reference belongs to the design tool and is not needed to view them.
- Fonts load from Google Fonts: Inter, Nunito, Noto Sans TC. Offline, a fallback font is used and text widths differ slightly.

## Screens

| # | Image | Source | Size (px) | Title |
|---|-------|--------|-----------|-------|
| 01 | `png/01-desktop-workspace.png` | `source/Main.dc.html` | 1440x900 | Trip workspace — desktop |
| 02 | `png/02-phone-workspace.png` | `source/Phone.dc.html` | 390x844 | Trip workspace — phone |
| 03 | `png/03-event-panel-phone-sheet.png` | `source/EventPanel.dc.html` | 470x900 | Event panel — phone bottom sheet |
| 04 | `png/04-event-panel-side.png` | `source/EventPanelSide.dc.html` | 1440x900 | Event panel — default: side panel (Expand → modal) |
| 05 | `png/05-event-panel-modal.png` | `source/EventPanelModal.dc.html` | 1440x900 | Event panel — expanded: modal (Collapse → side panel) |
| 06 | `png/06-map-view.png` | `source/MapView.dc.html` | 1440x900 | Map View |
| 07 | `png/07-event-panel-kinds-desktop.png` | `source/PanelKinds.dc.html` | 1840x1080 | Event panel by kind — desktop (Attraction · Meal · Lodging · Transport) |
| 08 | `png/08-event-panel-kinds-phone.png` | `source/PanelKindsPhone.dc.html` | 1710x1260 | Event panel by kind — phone bottom sheets |
| 09 | `png/09-panel-switch-kind.png` | `source/PanelSwitch.dc.html` | 1660x1040 | Switching kind — Attraction to Lodging, before and after (after state) |
| 10 | `png/10-lodging-banner.png` | `source/LodgingBanner.dc.html` | 1400x900 | Lodging banner in Day columns — 3 nights, Day 1 to Day 4 |
| 11 | `png/11-day-header-menu.png` | `source/DayHeader.dc.html` | 1180x800 | Day header — handle, states and Day menu (desktop) |
| 12 | `png/12-day-drag.png` | `source/DayDrag.dc.html` | 1440x900 | Dragging a Day — lifted Day, drop position, live renumbering |
| 13 | `png/13-day-delete.png` | `source/DayDelete.dc.html` | 1440x900 | Delete Day — confirmation and undo toast |
| 14 | `png/14-day-menu-phone.png` | `source/DayMenuPhone.dc.html` | 1330x930 | Day menu and delete confirmation — phone |
| 15 | `png/15-day-swap-lodging.png` | `source/DaySwapLodging.dc.html` | 1440x940 | Swapping two Days — the 3-night stay stays in place |
| 16 | `png/16-landing.webp` | `source/Landing.dc.html` | 2300x1000 | Landing — desktop and phone |
| 17 | `png/17-notes-panel.png` | `source/NotesPanel.dc.html` | 3040x1200 | Notes panel — open on Schedule and Map, movable, states, phone sheet |
| 18 | `png/18-viewer-mode.png` | `source/Viewer.dc.html` | 2040x900 | Viewer mode — read-only workspace and Event details |
| 19 | `png/19-dialogs.png` | `source/Dialogs.dc.html` | 2380x900 | Dialogs — Share (on / off), Export, Trip settings |
| 20 | `png/20-confirm-archive-delete.png` | `source/ConfirmEvent.dc.html` | 2000x880 | Archive and delete confirmations, toasts, phone |
| 21 | `png/21-export-image.png` | `source/ExportImage.dc.html` | 1960x1120 | Exported image — poster |
| 22 | `png/22-states-empty-loading.png` | `source/StatesEmpty.dc.html` | 2000x1000 | States — empty Trip, Day, Backlog and Archive; loading |
| 23 | `png/23-states-errors.png` | `source/StatesErrors.dc.html` | 2000x1180 | States — errors and limit reached |
| 24 | `png/24-trip-list.png` | `source/TripList.dc.html` | 4660x920 | Trip list — sidebar, item menu, New Trip (Blank / Generate with AI), Delete Trip, phone |
| 25 | `png/25-leg-detail.png` | `source/LegDetail.dc.html` | 3300x900 | Leg — chooser, detail, warning, cannot calculate, phone sheet |
| 26 | `png/26-event-image.webp` | `source/EventImage.dc.html` | 2340x1060 | Event image — panel states and Event block |
| 27 | `png/27-trip-list-nav.png` | `source/TripListNav.dc.html` | 4540x940 | Trip list — collapsed rail, drawer, pinned; Backlog/Archive collapse; switching Trips |
| 28 | `png/28-states-generic.png` | `source/StatesGeneric.dc.html` | 2000x900 | Empty state, loading skeleton and error banner — one generic style each |
| 29 | `png/29-ds-tokens.png` | `source/DSTokens.dc.html` | 1900x1180 | Design system — color tokens (light and dark), type scale, spacing, radius, shadow |
| 30 | `png/30-ds-components.png` | `source/DSComponents.dc.html` | 2400x1180 | Design system — components and their states |
| 31 | `png/31-ds-overlays.png` | `source/DSOverlays.dc.html` | 1800x1180 | Design system — dialogs, popovers, banners, tooltips and the shortcut format |
| 32 | `png/32-desktop-workspace-dark.png` | `source/MainDark.dc.html` | 1440x900 | Trip workspace — desktop, dark theme |
| 33 | `png/33-desktop-workspace-collapsed.png` | `source/MainCollapsed.dc.html` | 1440x900 | Trip workspace — desktop, both side panels collapsed |
| 34 | `png/34-guest-workspace.png` | `source/GuestWorkspace.dc.html` | 2940x960 | Guest workspace — Log in to save, phone banner and “…” menu, login note |
| 35 | `png/35-guest-login-tooltip.png` | `source/GuestTooltip.dc.html` | 2340x1956 | Guest workspace — tooltip on “Log in to save your progress” |
| 36 | `png/36-login-hosted.webp` | `source/LoginHosted.dc.html` | 5780x2456 | Hosted login page (Auth0, themed) — log in, sign up, wrong password |
| 37 | `png/37-login-return.png` | `source/LoginReturn.dc.html` | 5780x2266 | Returning to the app after login — Trip added, Trip list, login didn’t complete |
| 38 | `png/38-account-menu.png` | `source/AccountMenu.dc.html` | 5780x2266 | Account menu — logged out, logged in, open |
| 39 | `png/39-logout.webp` | `source/Logout.dc.html` | 2340x1956 | Log out — Landing with “You’re logged out” toast |
| 40 | `png/40-session-expired.png` | `source/SessionExpired.dc.html` | 2340x1956 | Session expired while editing — read-only Trip and banner |
| 41 | `png/41-invite-editor.webp` | `source/InviteEditor.dc.html` | 2340x1956 | Invited Editor from an email link, logged out (no photos) |
| 42 | `png/42-notes-panel.png` | `source/NotesStates.dc.html` | 1960x2920 | Notes panel — new Note, list, open Note; desktop and phone, light and dark (current Notes design; replaces 17) |
| 43 | `png/43-empty-slot.png` | `source/EmptySlot.dc.html` | 1500x1250 | Empty time slot — Add Event and Add Travel on hover (desktop) and tap (phone) |
| 44 | `png/44-opening-hours.png` | `source/OpeningHours.dc.html` | 1960x1740 | Opening hours — Event panel section states (off, loading, on, Whole week, conflict, no dates, no hours, read-only, dark, phone) and the amber card label |
| 45 | `png/45-trip-dates.png` | `source/TripDates.dc.html` | 1960x1320 | Trip dates — start date entry points (top bar, phone menu, Trip list), Trip settings with and without dates, date picker, Day headers and phone Day tabs. Top-bar date button, "Add dates" and the picker are proposed |
| 46 | `png/46-event-panel-actions.png` | `source/EventPanelActions.dc.html` | 2280x1120 | Event panel — kind dropdown (open), footer by state (Cancel / Save, ⋯ menu), ⋯ menu per state, phone footer, and the full side panel with the ⋯ menu open |
| 47 | `png/47-phone-menus.png` | `source/PhoneMenus.dc.html` | 1840x1500 | Phone — Account sheet (logged in, guest), Trip `⋯` sheet (Owner, Editor, guest), top bar by role (Owner, Editor, Viewer logged out and in, guest) |

## Notes

- All people, emails, links and places in the mockups are made up (for example `example.com`, "Lena", "Mei", "Ken").
- Photos in `source/assets/` are Unsplash placeholders, used under the Unsplash License; author attribution is added at the end of the project (see `docs/implementation-plan.md`).
