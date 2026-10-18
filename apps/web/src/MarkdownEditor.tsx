import { EditorContent, useEditor } from "@tiptap/react";
import { markdownExtensions } from "./markdown-extensions";

type Props = {
  label: string;
  // The starting Markdown. The editor keeps its own state afterwards; remount it (key) to reset.
  value: string;
  onChange: (markdown: string) => void;
  onBlur: () => void;
};

// A Markdown editor that shows the formatting as you type (Cmd+B makes bold text, "- " starts a
// list) and stores plain Markdown. Only standard Markdown is used (see markdown-extensions.ts).
// Checkboxes are formatting only (PRD §5.1). Syntax the editor has no node for is not kept when a
// Description is edited and saved again: images, reference links and footnotes.
export function MarkdownEditor({ label, value, onChange, onBlur }: Props) {
  const editor = useEditor({
    extensions: markdownExtensions,
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: { "aria-label": label, "aria-multiline": "true", role: "textbox" },
    },
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
    onBlur,
  });

  return <EditorContent editor={editor} className="md-editor" />;
}
