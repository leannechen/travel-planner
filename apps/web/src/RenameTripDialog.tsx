import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useT } from "./preferences";

type Props = {
  title: string;
  // Rejects when the Trip could not be renamed.
  onRename: (title: string) => Promise<void>;
  onClose: () => void;
};

// Renaming a Trip, in the style of Trip settings (design 19, 45). Nothing is saved until Save;
// Cancel, the close button and Esc leave the title as it was.
export function RenameTripDialog({ title, onRename, onClose }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const trimmed = draft.trim();
  const canSave = !saving && trimmed !== "" && trimmed !== title;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setFailed(false);
    try {
      await onRename(trimmed);
      onClose();
    } catch {
      setSaving(false);
      setFailed(true);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog settings-dialog"
      aria-labelledby="rename-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onClose();
      }}
      onClose={onClose}
    >
      <form onSubmit={(e) => void save(e)}>
        <div className="settings-head">
          <h2 id="rename-title">{t("tripList.rename")}</h2>
          <button type="button" className="ib" aria-label={t("generic.close")} title={t("generic.closeEsc")} disabled={saving} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="settings-field">
          <label htmlFor="rename-trip">{t("tripList.renameLabel")}</label>
          <input id="rename-trip" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onFocus={(e) => e.target.select()} />
        </div>
        {failed && <p role="alert">{t("tripList.renameError")}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={saving} onClick={onClose}>
            {t("generic.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!canSave}>
            {saving ? t("generic.saving") : t("generic.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
