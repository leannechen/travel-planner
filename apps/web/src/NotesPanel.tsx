import { clampPosition, noteTitle, orderNotes, type Note, type Point } from "@travel-planner/shared";
import { ArrowLeft, GripHorizontal, List, Pin, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useIsPhone } from "./phone";
import { useT } from "./preferences";

const POSITION_KEY = "travel-planner.notes-position";
// What was open when the panel was closed, for the rest of the browser session (PRD §5.1).
const SESSION_KEY = "travel-planner.notes-session";
const WIDTH = 360;
const AUTOSAVE_MS = 800;

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

type Where = { tripId: string; view: "new" | "list" | "note"; noteId?: string };

function readSession(): Where | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as Where | undefined;
  } catch {
    return undefined;
  }
}

function writeSession(where: Where) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(where));
  } catch {
    // Without storage the panel starts a new Note each time.
  }
}

// The first open of a session starts a new Note; later ones return to what was open.
function startingPoint(tripId: string, notes: Note[]): Where {
  const last = readSession();
  if (!last) return { tripId, view: "new" };
  if (last.tripId !== tripId) return { tripId, view: "list" };
  if (last.view === "note" && !notes.some((n) => n.id === last.noteId)) return { tripId, view: "list" };
  return last;
}

type Props = {
  tripId: string;
  notes: Note[];
  onAdd: (body: string) => Promise<Note>;
  onUpdate: (noteId: string, input: { body?: string; pinned?: boolean }) => Promise<void>;
  // Deletes a Note and offers Undo; the page shows the toast.
  onDelete: (note: Note) => Promise<void>;
  onClose: () => void;
  // Filled with the panel's own close, which saves first; the shortcut and the Notes button use it.
  closeRef: { current: (() => void) | undefined };
};

// The Trip's Notes in a floating panel with three states: a new Note, the list, one open Note.
// The text is plain Markdown as typed. It is saved shortly after typing stops, and when the user
// leaves the field, the Note or the panel.
export function NotesPanel({ tripId, notes, onAdd, onUpdate, onDelete, onClose, closeRef }: Props) {
  const t = useT();
  const phone = useIsPhone();
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<Point>(() => readPosition() ?? { x: Math.max(0, window.innerWidth - WIDTH - 16), y: 72 });

  const [where] = useState(() => startingPoint(tripId, notes));
  const [view, setView] = useState<"edit" | "list">(where.view === "list" ? "list" : "edit");
  // The Note in the field: none while it is new and not saved yet.
  const [currentId, setCurrentId] = useState<string | undefined>(where.view === "note" ? where.noteId : undefined);
  const [text, setText] = useState(() => (where.view === "note" ? (notes.find((n) => n.id === where.noteId)?.body ?? "") : ""));
  // Changes when another Note (or a new one) is put in the field, so the field starts fresh.
  const [fieldKey, setFieldKey] = useState(0);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // The same values readable from saves that run later.
  const textRef = useRef(text);
  const idRef = useRef(currentId);
  const sentRef = useRef(text);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const size = () => {
    const box = panel.current?.getBoundingClientRect();
    return { width: box?.width ?? WIDTH, height: box?.height ?? 200 };
  };
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  // Keeps the panel in view when the window gets smaller, and when the panel grows.
  useEffect(() => {
    const keepInView = () => setPosition((p) => clampPosition(p, size(), viewport()));
    keepInView();
    window.addEventListener("resize", keepInView);
    const observer = new ResizeObserver(keepInView);
    if (panel.current) observer.observe(panel.current);
    return () => {
      window.removeEventListener("resize", keepInView);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    writeSession({ tripId, view: view === "list" ? "list" : currentId ? "note" : "new", noteId: currentId });
  }, [tripId, view, currentId]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Saves the field: creates the Note on the first text, then updates it. Saves run one after
  // another. When the user is leaving a Note whose text is gone, the Note is deleted instead
  // (an empty Note never stays in the list). Answers whether it worked.
  function save(leaving: boolean): Promise<boolean> {
    clearTimeout(timer.current);
    queue.current = queue.current.then(async () => {
      const body = textRef.current;
      const id = idRef.current;
      if (body === sentRef.current) return true;
      if (body.trim() === "") {
        if (!id || !leaving) return true;
        const note = notesRef.current.find((n) => n.id === id);
        try {
          if (note) await onDelete(note);
        } catch {
          setStatus("error");
          return false;
        }
        idRef.current = undefined;
        sentRef.current = "";
        setCurrentId(undefined);
        return true;
      }
      setStatus("saving");
      try {
        if (id) {
          await onUpdate(id, { body });
        } else {
          const note = await onAdd(body);
          idRef.current = note.id;
          setCurrentId(note.id);
        }
        sentRef.current = body;
        setStatus("saved");
        return true;
      } catch {
        // The page shows the error; the text stays in the field.
        setStatus("error");
        return false;
      }
    });
    return queue.current;
  }

  function type(value: string) {
    textRef.current = value;
    setText(value);
    setStatus("idle");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(false), AUTOSAVE_MS);
  }

  // Puts a Note, or a new empty one, in the field. The old text is saved first.
  async function openField(note?: Note) {
    if (!(await save(true))) return;
    textRef.current = note?.body ?? "";
    sentRef.current = note?.body ?? "";
    idRef.current = note?.id;
    setText(textRef.current);
    setCurrentId(note?.id);
    setStatus("idle");
    setFieldKey((k) => k + 1);
    setView("edit");
  }

  async function showList() {
    if (await save(true)) setView("list");
  }

  // Saves what is typed, then closes. When a save fails the panel stays open with the text.
  async function close() {
    if (await save(true)) onClose();
  }
  closeRef.current = () => void close();

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

  const { pinned, recent } = orderNotes(notes);
  const emptyNew = view === "edit" && !currentId && text.trim() === "";

  return (
    <>
    {/* Phone: the page behind the sheet cannot be used; tapping it closes the panel (saving first). */}
    {phone && <div className="sheet-scrim notes-scrim" onClick={() => void close()} />}
    <section
      ref={panel}
      className="notes-panel"
      aria-label={t("notes.panel")}
      style={{ left: position.x, top: position.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") void close();
      }}
    >
      <header onPointerDown={dragStart}>
        <div className="notes-toolbar">
          {view === "edit" && currentId ? (
            <button type="button" aria-label={t("notes.back")} title={t("notes.back")} onClick={() => void showList()}>
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
          ) : (
            <>
            <button type="button" aria-label={t("notes.new")} title={t("notes.new")} disabled={emptyNew} onClick={() => void openField()}>
              <Plus size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-label={t("notes.all")} title={t("notes.all")} disabled={view === "list"} onClick={() => void showList()}>
              <List size={16} aria-hidden="true" />
            </button>
            </>
          )}
        </div>
        <GripHorizontal className="notes-grip" size={16} aria-hidden="true" />
        <button type="button" aria-label={t("notes.close")} title={t("generic.closeEsc")} onClick={() => void close()}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {view === "edit" ? (
        <div className="notes-body">
          <textarea
            key={fieldKey}
            aria-label={currentId ? t("notes.note") : t("notes.new")}
            placeholder={t("notes.placeholder")}
            autoFocus
            value={text}
            maxLength={20000}
            onChange={(e) => type(e.target.value)}
            onBlur={() => void save(true)}
          />
          <p className="notes-status" role="status">
            {status === "saved" && t("notes.saved")}
            {status === "saving" && t("generic.saving")}
          </p>
        </div>
      ) : (
        <div className="notes-body">
          {notes.length === 0 ? (
            <p className="holding-empty">{t("notes.empty")}</p>
          ) : (
            <ul className="notes-list">
              {[...pinned, ...recent].map((note) => (
                <li key={note.id}>
                  <button type="button" className="note-title" onClick={() => void openField(note)}>
                    {noteTitle(note.body, t("notes.emptyTitle"))}
                  </button>
                  <button
                    type="button"
                    className={note.pinned ? "pin pinned" : "pin"}
                    aria-label={note.pinned ? t("notes.unpinNote") : t("notes.pinNote")}
                    aria-pressed={note.pinned}
                    title={note.pinned ? t("notes.unpin") : t("notes.pin")}
                    onClick={() => void onUpdate(note.id, { pinned: !note.pinned }).catch(() => undefined)}
                  >
                    <Pin size={14} aria-hidden="true" fill={note.pinned ? "currentColor" : "none"} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("notes.deleteNote")}
                    title={t("notes.delete")}
                    onClick={() => void onDelete(note).catch(() => undefined)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
    </>
  );
}
