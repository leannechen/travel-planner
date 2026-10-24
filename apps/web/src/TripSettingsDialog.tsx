import { MAX_START_YEAR, MIN_START_YEAR, startDateSchema, type TravelMode } from "@travel-planner/shared";
import { useEffect, useRef, useState } from "react";
import { MODE_ICONS } from "./legFormat";
import { useT } from "./preferences";
import { X } from "lucide-react";

const MODES: TravelMode[] = ["drive", "transit", "walk"];

// What Save changes: only the fields that differ from the Trip.
export type SettingsChanges = { startDate?: string | null; travelMode?: TravelMode };

type Props = {
  tripTitle: string;
  startDate: string | undefined;
  travelMode: TravelMode;
  // Saves the changes; a null start date clears it. Rejects when they could not be saved.
  onSave: (changes: SettingsChanges) => Promise<void>;
  onClose: () => void;
};

// Trip settings (design 19, 45): the start date and the default travel mode. Nothing is saved until
// Save; Cancel, the close button and Esc leave the Trip as it was. The default travel mode is only
// what a new Leg starts with; the Legs already there keep theirs. The title comes later.
export function TripSettingsDialog({ tripTitle, startDate, travelMode, onSave, onClose }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // The date in the field: "" when empty. A half-typed date is not a date to save.
  const [draft, setDraft] = useState(startDate ?? "");
  const [mode, setMode] = useState(travelMode);
  const [incomplete, setIncomplete] = useState(false);
  // Changes when Clear empties the field, so the field starts again from empty.
  const [fieldKey, setFieldKey] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const valid = draft === "" || startDateSchema.safeParse(draft).success;
  const dateChanged = draft !== (startDate ?? "");
  const changed = dateChanged || mode !== travelMode;
  const canSave = !saving && !incomplete && valid && changed;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSave({
        ...(dateChanged && { startDate: draft === "" ? null : draft }),
        ...(mode !== travelMode && { travelMode: mode }),
      });
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
        if (!saving) onClose();
      }}
      onClose={onClose}
    >
      <div className="settings-head">
        <h2 id="settings-title">{t("trip.settings")}</h2>
        <button type="button" className="ib" aria-label={t("generic.close")} title={t("generic.closeEsc")} disabled={saving} onClick={onClose}>
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
      </div>
      <fieldset className="settings-field new-trip-mode">
        <legend>{t("newTrip.mode")}</legend>
        <div className="segmented">
          {MODES.map((value) => {
            const Icon = MODE_ICONS[value];
            return (
              <label key={value} className={value === mode ? "on" : undefined}>
                <input type="radio" name="trip-mode" value={value} checked={value === mode} onChange={() => setMode(value)} />
                <Icon size={14} aria-hidden="true" />
                {t(`leg.${value}`)}
              </label>
            );
          })}
        </div>
        <p className="hint">{t("trip.modeHint")}</p>
      </fieldset>
      {failed && <p role="alert">{t("trip.saveError")}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" disabled={saving} onClick={onClose}>
          {t("generic.cancel")}
        </button>
        <button type="button" className="btn primary" disabled={!canSave} onClick={() => void save()}>
          {saving ? t("generic.saving") : t("generic.save")}
        </button>
      </div>
    </dialog>
  );
}
