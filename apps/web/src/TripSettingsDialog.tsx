import { MAX_START_YEAR, MIN_START_YEAR, startDateSchema } from "@travel-planner/shared";
import { useEffect, useRef, useState } from "react";
import { useT } from "./preferences";
import { X } from "lucide-react";

type Props = {
  tripTitle: string;
  startDate: string | undefined;
  // Saves the start date; null clears it. Rejects when it could not be saved.
  onChangeStartDate: (startDate: string | null) => Promise<void>;
  onClose: () => void;
};

// Trip settings (design 19, 45). So far only the start date. Nothing is saved until Save; Cancel,
// the close button and Esc leave the Trip as it was. The title and default travel mode come later.
export function TripSettingsDialog({ tripTitle, startDate, onChangeStartDate, onClose }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // The date in the field: "" when empty. A half-typed date is not a date to save.
  const [draft, setDraft] = useState(startDate ?? "");
  const [incomplete, setIncomplete] = useState(false);
  // Changes when Clear empties the field, so the field starts again from empty.
  const [fieldKey, setFieldKey] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const valid = draft === "" || startDateSchema.safeParse(draft).success;
  const changed = draft !== (startDate ?? "");
  const canSave = !saving && !incomplete && valid && changed;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setFailed(false);
    try {
      await onChangeStartDate(draft === "" ? null : draft);
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
      aria-labelledby="settings-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="settings-head">
        <h2 id="settings-title">{t("trip.settings")}</h2>
        <button type="button" className="ib" aria-label={t("generic.close")} title={t("generic.closeEsc")} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="settings-trip">{tripTitle}</p>
      <div className="settings-field">
        <label htmlFor="trip-start-date">
          {t("trip.startDate")} · {t("trip.optional")}
        </label>
        <div className="settings-date">
          {/* The browser's own date field and picker; typing a date works too. */}
          <input
            key={fieldKey}
            id="trip-start-date"
            type="date"
            defaultValue={draft}
            autoFocus
            title={t("trip.pickDate")}
            min={`${MIN_START_YEAR}-01-01`}
            max={`${MAX_START_YEAR}-12-31`}
            onChange={(e) => {
              setDraft(e.target.value);
              setIncomplete(e.target.validity.badInput);
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={draft === "" && !incomplete}
            onClick={() => {
              setDraft("");
              setIncomplete(false);
              setFieldKey((key) => key + 1);
            }}
          >
            {t("trip.clearDate")}
          </button>
        </div>
        <p className="hint">{t("trip.datesHint")}</p>
        {failed && <p role="alert">{t("trip.dateError")}</p>}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t("generic.cancel")}
        </button>
        <button type="button" className="btn primary" disabled={!canSave} onClick={() => void save()}>
          {saving ? t("generic.saving") : t("generic.save")}
        </button>
      </div>
    </dialog>
  );
}
