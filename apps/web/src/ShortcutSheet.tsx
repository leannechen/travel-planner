import { SHORTCUTS } from "@travel-planner/shared";
import { useEffect, useRef } from "react";

const groups = ["Events", "Selection", "Anywhere"] as const;

// The cheat sheet opened with "?". A modal dialog, so Escape closes it and the page behind is inert.
export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog shortcut-sheet"
      aria-labelledby="shortcut-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="shortcut-title">Keyboard shortcuts</h2>
      <p className="hint">Single keys work when no text field has focus.</p>
      {groups.map((group) => (
        <section key={group}>
          <h3>{group}</h3>
          <dl>
            {SHORTCUTS.filter((s) => s.group === group).map((s) => (
              <div key={s.id}>
                <dt>
                  <kbd>{s.keys}</kbd>
                </dt>
                <dd>{s.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <div className="dialog-actions">
        <button type="button" autoFocus onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
