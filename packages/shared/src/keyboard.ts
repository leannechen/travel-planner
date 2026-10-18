// Pure rules for moving the selection with the arrow keys, and the list of shortcuts shown in
// tooltips and the cheat sheet. Columns are the Backlog, then the Days left to right. The Archive
// is collapsed by default and drawn under the Backlog, so it only takes part when the selected
// Event is already in it (it then sits next to the Backlog).

import type { Areas } from "./event-list";
import type { Event } from "./index";

export type Direction = "up" | "down" | "left" | "right";

const columns = (areas: Areas, currentId: string | undefined): Event[][] => [
  areas.backlog,
  ...(areas.archive.some((e) => e.id === currentId) ? [areas.archive] : []),
  ...areas.days.map((d) => d.events),
];

// The Event the arrow key leads to, or `undefined` when there is none in that direction. With no
// current selection any arrow selects the first Event on the board. Up and down walk one column;
// left and right go to the nearest column that has Events, picking the Event whose start time is
// closest to the current one (the first of them on a tie).
export function neighbour(areas: Areas, currentId: string | undefined, direction: Direction): Event | undefined {
  const all = columns(areas, currentId);
  if (!currentId) return all.find((c) => c.length > 0)?.[0];
  const col = all.findIndex((c) => c.some((e) => e.id === currentId));
  if (col === -1) return all.find((c) => c.length > 0)?.[0];
  const events = all[col]!;
  const row = events.findIndex((e) => e.id === currentId);
  if (direction === "up") return events[row - 1];
  if (direction === "down") return events[row + 1];
  const step = direction === "left" ? -1 : 1;
  const here = events[row]!;
  for (let i = col + step; i >= 0 && i < all.length; i += step) {
    const column = all[i]!;
    if (column.length === 0) continue;
    return column.reduce((best, e) =>
      Math.abs(e.startMinute - here.startMinute) < Math.abs(best.startMinute - here.startMinute) ? e : best,
    );
  }
  return undefined;
}

// The Day to the left or right of the Day with `dayId`.
export function adjacentDayId(areas: Areas, dayId: string, step: -1 | 1): string | undefined {
  const index = areas.days.findIndex((d) => d.id === dayId);
  return index === -1 ? undefined : areas.days[index + step]?.id;
}

export type Shortcut = { id: string; keys: string; label: string; group: "Events" | "Selection" | "Anywhere" };

// Single keys work when no text field has focus; the Notes shortcut works everywhere.
export const SHORTCUTS: Shortcut[] = [
  { id: "new-event", keys: "N", label: "New Event on the selected Event's Day", group: "Events" },
  { id: "new-backlog", keys: "B", label: "New Event in the Backlog", group: "Events" },
  { id: "open", keys: "Enter", label: "Edit the selected Event", group: "Events" },
  { id: "delete", keys: "Delete", label: "Delete the selected Event", group: "Events" },
  { id: "nudge", keys: "Shift+↑ / Shift+↓", label: "Move the selected Event 15 minutes earlier or later", group: "Events" },
  { id: "day", keys: "Shift+← / Shift+→", label: "Move the selected Event to the previous or next Day", group: "Events" },
  { id: "move", keys: "↑ ↓ ← →", label: "Select another Event", group: "Selection" },
  { id: "clear", keys: "Esc", label: "Clear the selection, or close the panel", group: "Selection" },
  { id: "notes", keys: "Ctrl+Alt+N", label: "Open or close Notes", group: "Anywhere" },
  { id: "help", keys: "?", label: "Show this list", group: "Anywhere" },
];

export const shortcutKeys = (id: string) => SHORTCUTS.find((s) => s.id === id)?.keys;
// A tooltip with its shortcut: "Notes (Ctrl+Alt+N)".
export const withShortcut = (label: string, id: string) => `${label} (${shortcutKeys(id)})`;
