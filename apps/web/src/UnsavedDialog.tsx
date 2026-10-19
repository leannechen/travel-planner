import { useEffect, useRef } from "react";
import { useT } from "./preferences";

type Props = {
  onSave: () => void;
  onDiscard: () => void;
  onKeep: () => void;
  // A save is running: the buttons wait for it.
  busy?: boolean;
};

// Asked when the Event panel is left with changes that are not saved. "Keep editing" is focused
// first, so Enter never saves or discards by accident; Escape keeps editing.
export function UnsavedDialog({ onSave, onDiscard, onKeep, busy }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby="unsaved-title" onCancel={(e) => { e.preventDefault(); onKeep(); }} onClose={onKeep}>
      <h2 id="unsaved-title">{t("unsaved.title")}</h2>
      <p>{t("unsaved.body")}</p>
      <div className="dialog-actions">
        <button type="button" autoFocus onClick={onKeep}>
          {t("unsaved.keep")}
        </button>
        <button type="button" disabled={busy} onClick={onDiscard}>
          {t("unsaved.discard")}
        </button>
        <button type="button" className="primary" disabled={busy} onClick={onSave}>
          {t("event.save")}
        </button>
      </div>
    </dialog>
  );
}
