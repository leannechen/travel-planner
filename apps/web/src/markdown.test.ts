import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "./markdown-extensions";

// What the editor writes back after loading stored Markdown. The first edit rewrites the whole
// Description, so anything lost here is lost for good.
const manager = new MarkdownManager({ extensions: markdownExtensions });
const roundTrip = (markdown: string) => manager.serialize(manager.parse(markdown)).trim();

describe("Markdown round trip", () => {
  it("keeps formatting, links, lists and task lists", () => {
    const markdown = "**bold** and *italic* and [a link](https://example.com)\n\n- one\n- two\n\n- [ ] todo\n- [x] done";
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("keeps text that only looks like Markdown syntax as text", () => {
    for (const text of ["2026. A good year", "1) first", "# 3 gate", "- not a list", "+ plus", "> not a quote", "---", "***"]) {
      const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
      const reloaded = manager.parse(manager.serialize(doc));
      expect(reloaded.content, text).toEqual(doc.content);
    }
  });
});
