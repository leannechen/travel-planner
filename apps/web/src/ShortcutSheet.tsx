import { SHORTCUTS } from "@travel-planner/shared";
import type { MessageKey } from "./messages";
import { useEffect, useRef } from "react";
import { keysFor } from "./shortcuts";
import { useT } from "./preferences";

const groups = ["Events", "Selection", "Anywhere"] as const;

// The cheat sheet opened with "?". A modal dialog, so Escape closes it and the page behind is inert.
export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
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
      <h2 id="shortcut-title">{t("shortcuts.title")}</h2>
      <p className="hint">{t("shortcuts.hint")}</p>
      {groups.map((group) => (
        <section key={group}>
          <h3>{t(`shortcuts.group.${group}` as const)}</h3>
          <dl>
            {SHORTCUTS.filter((s) => s.group === group).map((s) => (
              <div key={s.id}>
                <dt>
                  <kbd>{keysFor(s)}</kbd>
                </dt>
                <dd>{t(`shortcut.${s.id}` as MessageKey)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <div className="dialog-actions">
        <button type="button" autoFocus onClick={onClose}>
          {t("generic.close")}
        </button>
      </div>
    </dialog>
  );
}
