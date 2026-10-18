import { clampPosition, editedAgo, noteDisplay, orderNotes, type Note, type Point } from "@travel-planner/shared";
import { Pin, PinOff, Trash2, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

// The editor is large, so it is loaded when the panel first opens, not with the page.
const MarkdownEditor = lazy(() => import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })));

const POSITION_KEY = "travel-planner.notes-position";
const WIDTH = 360;

function readPosition(): Point | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null") as Partial<Point> | null;
    return typeof value?.x === "number" && typeof value.y === "number" ? { x: value.x, y: value.y } : undefined;
  } catch {
    return undefined;
  }
}

function savePosition(position: Point) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // The panel just opens at its default place next time.
  }
}

type Props = {
  notes: Note[];
  onAdd: (body: string) => Promise<Note>;
  onUpdate: (noteId: string, input: { body?: string; pinned?: boolean }) => Promise<void>;
  onDelete: (noteId: string) => Promise<void>;
  onClose: () => void;
  // Filled with the panel's own close, which saves first; the shortcut and the Notes button use it.
  closeRef: { current: (() => void) | undefined };
};

// The Trip's Notes in a floating panel: a field for a new Note on top, then pinned Notes, then the
// rest by most recent edit. The header can be dragged; the position is remembered. Text is saved
// when a field is left, or when the panel is closed.
export function NotesPanel({ notes, onAdd, onUpdate, onDelete, onClose, closeRef }: Props) {
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<Point>(() => readPosition() ?? { x: Math.max(0, window.innerWidth - WIDTH - 16), y: 72 });
  const [editingId, setEditingId] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<Note | undefined>();
  // The text of the new-Note field and of the Note being edited, as last typed.
  const draft = useRef("");
  const edited = useRef<{ id: string; body: string } | undefined>(undefined);
  // Changes after a Note is created, which empties the new-Note field.
  const [draftKey, setDraftKey] = useState(0);
  // The save of the new-Note field that is running, so a second flush waits for it.
  const draftFlush = useRef<Promise<boolean> | undefined>(undefined);
  // The text last sent for each Note, so leaving a field twice does not send it twice.
  const sentBodies = useRef(new Map<string, string>());
  // While a Note is being edited the list keeps the order the user saw: saving it would move it to
  // the top, and moving the focused Note's element in the page drops its caret.
  const frozenOrder = useRef<string[] | undefined>(undefined);
  const ordered = orderNotes(notes);
  const keepSeen = (list: Note[]) => {
    const seen = frozenOrder.current;
    if (!seen) return list;
    const rank = (n: Note) => seen.indexOf(n.id);
    return [...list].sort((a, b) => rank(a) - rank(b));
  };
  const pinned = keepSeen(ordered.pinned);
  const recent = keepSeen(ordered.recent);

  const size = () => {
    const box = panel.current?.getBoundingClientRect();
    return { width: box?.width ?? WIDTH, height: box?.height ?? 200 };
  };
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  // Keeps the panel in view when the window gets smaller.
  useEffect(() => {
    const onResize = () => setPosition((p) => clampPosition(p, size(), viewport()));
    onResize();
    window.addEventListener("resize", onResize);
    // The panel also grows by itself (more Notes, a Note opened for editing).
    const observer = new ResizeObserver(onResize);
    if (panel.current) observer.observe(panel.current);
    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, []);

  // Saves the new-Note field: creates the Note, and if more was typed while that was running,
  // updates the Note just created, until the field and the Note agree. Then the field is emptied.
  // Answers whether everything was saved.
  function flushDraft(): Promise<boolean> {
    if (draftFlush.current) return draftFlush.current;
    const run = (async () => {
      try {
        let id: string | undefined;
        let sent = "";
        while (draft.current.trim() !== "" && draft.current !== sent) {
          const body = draft.current;
          if (id) await onUpdate(id, { body });
          else id = (await onAdd(body)).id;
          sent = body;
        }
        if (id) {
          draft.current = "";
          setDraftKey((k) => k + 1);
        }
        return true;
      } catch {
        // The caller shows the error; the text stays in the field.
        return false;
      } finally {
        draftFlush.current = undefined;
      }
    })();
    draftFlush.current = run;
    return run;
  }

  async function flushEdit(): Promise<boolean> {
    const current = edited.current;
    const original = current && notes.find((n) => n.id === current.id);
    if (!current || !original) return true;
    if (current.body === (sentBodies.current.get(current.id) ?? original.body)) return true;
    sentBodies.current.set(current.id, current.body);
    try {
      await onUpdate(current.id, { body: current.body });
      return true;
    } catch {
      // The caller shows the error; the text stays in the editor.
      sentBodies.current.delete(current.id);
      return false;
    }
  }

  // Saves what is typed, then closes. When a save fails the panel stays open with the text.
  async function close() {
    const saved = await Promise.all([flushDraft(), flushEdit()]);
    if (saved.every(Boolean)) onClose();
  }
  closeRef.current = () => void close();

  function startEditing(note: Note) {
    if (editingId === note.id) return;
    void flushEdit();
    frozenOrder.current ??= [...pinned, ...recent].map((n) => n.id);
    edited.current = { id: note.id, body: note.body };
    setEditingId(note.id);
  }

  function dragStart(e: React.PointerEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const grab = { x: e.clientX - position.x, y: e.clientY - position.y };
    let latest = position;
    const move = (ev: PointerEvent) => {
      latest = clampPosition({ x: ev.clientX - grab.x, y: ev.clientY - grab.y }, size(), viewport());
      setPosition(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      savePosition(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function card(note: Note) {
    const editing = editingId === note.id;
    const { title, preview } = noteDisplay(note.body);
    return (
      <li key={note.id} className={editing ? "note editing" : "note"}>
        {editing ? (
          <Suspense fallback={<div className="md-editor-loading">Loading editor…</div>}>
            <MarkdownEditor
              label="Note"
              value={note.body}
              autoFocus
              onChange={(body) => (edited.current = { id: note.id, body })}
              onBlur={() => void flushEdit()}
            />
          </Suspense>
        ) : (
          <button type="button" className="note-main" onClick={() => startEditing(note)}>
            <strong>{title}</strong>
            {preview && <span>{preview}</span>}
            <span className="hint">{editedAgo(note.updatedAt, new Date())}</span>
          </button>
        )}
        <div className="note-actions">
          <button
            type="button"
            aria-label={note.pinned ? "Unpin Note" : "Pin Note"}
            title={note.pinned ? "Unpin" : "Pin"}
            onClick={() => void onUpdate(note.id, { pinned: !note.pinned }).catch(() => undefined)}
          >
            {note.pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
          </button>
          <button type="button" aria-label="Delete Note" title="Delete" onClick={() => setDeleting(note)}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </li>
    );
  }

  return (
    <section
      ref={panel}
      className="notes-panel"
      aria-label="Notes"
      style={{ left: position.x, top: position.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !deleting) void close();
      }}
    >
      <header onPointerDown={dragStart}>
        <h3>
          Notes <span className="count">{notes.length}</span>
        </h3>
        <button type="button" aria-label="Close Notes" onClick={() => void close()}>
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      <div className="notes-body">
        <div className="note-new">
          <Suspense fallback={<div className="md-editor-loading">Loading editor…</div>}>
            <MarkdownEditor
              key={draftKey}
              label="New Note"
              value=""
              // Only when the panel opens: a field emptied after a save must not take the focus.
              autoFocus={draftKey === 0}
              onChange={(body) => (draft.current = body)}
              onBlur={() => void flushDraft()}
            />
          </Suspense>
          <span className="hint">Write a Note… Markdown works. Notes save automatically.</span>
        </div>
        {notes.length === 0 && <p className="holding-empty">No Notes yet. Type above to add the first one.</p>}
        {pinned.length > 0 && (
          <>
            <h4>Pinned</h4>
            <ul>{pinned.map(card)}</ul>
          </>
        )}
        {recent.length > 0 && (
          <>
            {pinned.length > 0 && <h4>Recent</h4>}
            <ul>{recent.map(card)}</ul>
          </>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete this Note?"
          confirmLabel="Delete Note"
          onConfirm={() => {
            const note = deleting;
            setDeleting(undefined);
            if (editingId === note.id) {
              edited.current = undefined;
              setEditingId(undefined);
            }
            void onDelete(note.id).catch(() => undefined);
          }}
          onCancel={() => setDeleting(undefined)}
        >
          <p>“{noteDisplay(deleting.body).title}” will be deleted. This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
