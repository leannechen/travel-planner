import type { Note } from "./index";

// The Notes panel list: pinned Notes first, then the rest; each group by most recent edit (PRD
// §5.1). Notes edited at the same moment keep a fixed order (by id).
export function orderNotes(notes: readonly Note[]): { pinned: Note[]; recent: Note[] } {
  const sorted = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return { pinned: sorted.filter((n) => n.pinned), recent: sorted.filter((n) => !n.pinned) };
}

const stripMarkers = (line: string) =>
  line
    .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/, "")
    .replace(/[*_`~]+/g, "")
    .trim();

// What a Note looks like in the list: its first line as the title and the next two lines as a
// preview, with the Markdown markers left out.
export function noteDisplay(body: string): { title: string; preview: string } {
  const lines = body
    .split("\n")
    .map(stripMarkers)
    .filter((line) => line !== "");
  return { title: lines[0] ?? "Empty note", preview: lines.slice(1, 3).join(" · ") };
}

export type Point = { x: number; y: number };

// Moves a floating panel's top-left corner so the whole panel stays inside the window.
export function clampPosition(position: Point, size: { width: number; height: number }, viewport: { width: number; height: number }): Point {
  return {
    x: Math.max(0, Math.min(position.x, viewport.width - size.width)),
    y: Math.max(0, Math.min(position.y, viewport.height - size.height)),
  };
}

// "Edited 2 min ago", "Edited yesterday": how long ago a Note's text was last edited.
export function editedAgo(updatedAt: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 60_000);
  if (minutes < 1) return "Edited just now";
  if (minutes < 60) return `Edited ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Edited yesterday";
  if (days < 14) return `Edited ${days} days ago`;
  return `Edited ${Math.floor(days / 7)} weeks ago`;
}
