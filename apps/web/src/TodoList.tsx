import type { Todo } from "@travel-planner/shared";
import { useState } from "react";

type Props = {
  todos: Todo[];
  // Names the list for assistive technology, for example "Trip Todos".
  label: string;
  // Without it the list has no add field.
  addLabel?: string;
  onAdd?: (text: string) => Promise<void>;
  onToggle: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
};

// Todos with a checkbox each, and optionally a field to add one.
export function TodoList({ todos, label, addLabel, onAdd, onToggle, onDelete }: Props) {
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || adding || !onAdd) return;
    setAdding(true);
    try {
      await onAdd(value);
      setText("");
    } catch {
      // The caller shows the error; the text stays so it can be sent again.
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="todo-list">
      {todos.length > 0 && (
        <ul aria-label={label}>
          {todos.map((todo) => (
            <li key={todo.id} className={todo.done ? "done" : undefined}>
              <label>
                <input type="checkbox" checked={todo.done} onChange={() => onToggle(todo)} />
                <span>{todo.text}</span>
              </label>
              <button type="button" className="todo-delete" aria-label={`Delete Todo "${todo.text}"`} onClick={() => onDelete(todo)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {addLabel && onAdd && (
        <form className="todo-add" onSubmit={submit}>
          <input aria-label={addLabel} placeholder={addLabel} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={adding || !text.trim()}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}
