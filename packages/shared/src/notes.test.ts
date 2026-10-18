import { describe, expect, it } from "vitest";
import type { Note } from "./index";
import { clampPosition, noteTitle, orderNotes } from "./notes";

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

describe("noteTitle", () => {
  it("is the first line, without Markdown markers", () => {
    expect(noteTitle("# Ramen to try\n- Ichiran Kyoto")).toBe("Ramen to try");
    expect(noteTitle("Kyoto 3 + Osaka 2\n1. Maples")).toBe("Kyoto 3 + Osaka 2");
  });

  it("skips blank lines and strips list, quote, task and emphasis markers", () => {
    expect(noteTitle("\n\n> **Pack** rail pass\n- [ ] voucher")).toBe("Pack rail pass");
    expect(noteTitle("1. Maples")).toBe("Maples");
  });

  it("has a placeholder for a Note without text", () => {
    expect(noteTitle("  \n ")).toBe("Empty note");
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
