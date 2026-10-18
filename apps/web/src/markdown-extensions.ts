import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";

// Backslash-escapes text at the start of a line that would turn into a list, heading, quote or
// rule when read back (for example a pasted "2026. A good year").
function escapeBlockSyntax(markdown: string) {
  return markdown
    .replace(/^(\s{0,3})(-{3,}|\*{3,}|_{3,})\s*$/gm, "$1\\$2")
    .replace(/^(\s{0,3})(#{1,6}|[>+-])(?=\s|$)/gm, "$1\\$2")
    .replace(/^(\s{0,3}\d+)([.)])(?=\s|$)/gm, "$1\\$2");
}

const renderParagraph = Paragraph.config.renderMarkdown!;

// The links that may be in a Description. Anything else (javascript:, data:, relative) is not
// made into a link by the editor. The stored Markdown is not sanitized, so every other place that
// shows a Description as HTML must check links itself.
export const isAllowedLink = (url: string) => /^(https?:|mailto:|tel:)/i.test(url.trim());

export const markdownExtensions = [
  StarterKit.configure({
    underline: false,
    paragraph: false,
    link: { openOnClick: false, isAllowedUri: isAllowedLink },
  }),
  Paragraph.extend({
    renderMarkdown: (node, helpers, context) => escapeBlockSyntax(renderParagraph(node, helpers, context)),
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table,
  TableRow,
  // GFM table cells hold inline content only; a list or a second paragraph would not survive.
  TableHeader.extend({ content: "inline*" }),
  TableCell.extend({ content: "inline*" }),
  Markdown,
];
