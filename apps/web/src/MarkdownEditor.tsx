import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";

type Props = {
  label: string;
  // The starting Markdown. The editor keeps its own state afterwards; remount it (key) to reset.
  value: string;
  onChange: (markdown: string) => void;
  onBlur: () => void;
};

// A Markdown editor that shows the formatting as you type (Cmd+B makes bold text, "- " starts a
// list) and stores plain Markdown. Only standard Markdown is used: underline and other
// extensions that would need non-standard syntax are off. Links may only be http, https, mailto
// or tel. Checkboxes are formatting only (PRD §5.1).
export function MarkdownEditor({ label, value, onChange, onBlur }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        underline: false,
        link: { openOnClick: false, protocols: ["mailto", "tel"] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
      Markdown,
    ],
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
