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

// The title of a Note in the list: its first line with the Markdown markers left out.
export function noteTitle(body: string, empty = "Empty note"): string {
  const first = body
    .split("\n")
    .map(stripMarkers)
    .find((line) => line !== "");
  return first ?? empty;
}

export type Point = { x: number; y: number };

// Moves a floating panel's top-left corner so the whole panel stays inside the window.
export function clampPosition(position: Point, size: { width: number; height: number }, viewport: { width: number; height: number }): Point {
  return {
    x: Math.max(0, Math.min(position.x, viewport.width - size.width)),
    y: Math.max(0, Math.min(position.y, viewport.height - size.height)),
  };
}
