import { describe, expect, it } from "vitest";
import type { Note } from "./index";
import { clampPosition, editedAgo, noteDisplay, orderNotes } from "./notes";

const note = (id: string, updatedAt: string, pinned = false, body = id): Note => ({ id, body, pinned, updatedAt });

describe("orderNotes", () => {
  it("puts pinned Notes first, each group by most recent edit", () => {
    const notes = [
      note("old", "2026-01-01T00:00:00.000Z"),
      note("pin-old", "2026-01-02T00:00:00.000Z", true),
      note("new", "2026-03-01T00:00:00.000Z"),
      note("pin-new", "2026-02-01T00:00:00.000Z", true),
    ];
    const { pinned, recent } = orderNotes(notes);
    expect(pinned.map((n) => n.id)).toEqual(["pin-new", "pin-old"]);
    expect(recent.map((n) => n.id)).toEqual(["new", "old"]);
  });

  it("keeps a stable order for Notes edited at the same moment", () => {
    const t = "2026-01-01T00:00:00.000Z";
    expect(orderNotes([note("b", t), note("a", t)]).recent.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("does not change the list it is given", () => {
    const notes = [note("a", "2026-01-01T00:00:00.000Z"), note("b", "2026-02-01T00:00:00.000Z")];
    orderNotes(notes);
    expect(notes.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("noteDisplay", () => {
  it("uses the first line as the title, without Markdown markers, and the next lines as the preview", () => {
    expect(noteDisplay("# Ramen to try\n- Ichiran Kyoto\n- Menya Inoichi\n- Third")).toEqual({
      title: "Ramen to try",
      preview: "Ichiran Kyoto · Menya Inoichi",
    });
  });

  it("skips blank lines and strips list, quote and task markers", () => {
    expect(noteDisplay("\n\n> **Pack** rail pass\n\n- [ ] voucher")).toEqual({ title: "Pack rail pass", preview: "voucher" });
  });

  it("has no preview for a one-line Note and a placeholder title for an empty one", () => {
    expect(noteDisplay("Cash for small shrines")).toEqual({ title: "Cash for small shrines", preview: "" });
    expect(noteDisplay("  \n ")).toEqual({ title: "Empty note", preview: "" });
  });
});

describe("clampPosition", () => {
  const viewport = { width: 1000, height: 700 };
  const size = { width: 300, height: 400 };

  it("leaves a position that fits", () => {
    expect(clampPosition({ x: 100, y: 50 }, size, viewport)).toEqual({ x: 100, y: 50 });
  });

  it("keeps the whole panel inside the window", () => {
    expect(clampPosition({ x: -20, y: -5 }, size, viewport)).toEqual({ x: 0, y: 0 });
    expect(clampPosition({ x: 900, y: 600 }, size, viewport)).toEqual({ x: 700, y: 300 });
  });

  it("puts the top-left corner at the origin when the window is smaller than the panel", () => {
    expect(clampPosition({ x: 50, y: 50 }, size, { width: 200, height: 200 })).toEqual({ x: 0, y: 0 });
  });
});

describe("editedAgo", () => {
  const now = new Date("2026-05-10T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("says how long ago a Note was edited", () => {
    expect(editedAgo(ago(20_000), now)).toBe("Edited just now");
    expect(editedAgo(ago(2 * MIN), now)).toBe("Edited 2 min ago");
    expect(editedAgo(ago(3 * HOUR), now)).toBe("Edited 3 h ago");
    expect(editedAgo(ago(30 * HOUR), now)).toBe("Edited yesterday");
    expect(editedAgo(ago(3 * DAY), now)).toBe("Edited 3 days ago");
    expect(editedAgo(ago(14 * DAY), now)).toBe("Edited 2 weeks ago");
  });

  it("treats a time slightly in the future (clock differences) as just now", () => {
    expect(editedAgo(ago(-5000), now)).toBe("Edited just now");
  });
});
