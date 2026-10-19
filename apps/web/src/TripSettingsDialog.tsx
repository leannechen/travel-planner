import { MAX_START_YEAR, MIN_START_YEAR, startDateSchema } from "@travel-planner/shared";
import { useEffect, useRef, useState } from "react";
import { useT } from "./preferences";
import { X } from "lucide-react";

const SAVE_DELAY_MS = 800;

type Props = {
  tripTitle: string;
  startDate: string | undefined;
  // Saves the start date; null clears it. Rejects when it could not be saved.
  onChangeStartDate: (startDate: string | null) => Promise<void>;
  onClose: () => void;
};

// Trip settings (design 19, 45). So far only the start date: a change is saved at once, with no
// confirmation, and moves every Day's date. The title and default travel mode come later.
export function TripSettingsDialog({ tripTitle, startDate, onChangeStartDate, onClose }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // The date as saved, to enable Clear; the field itself keeps what is typed, so a half-typed date
  // is never mistaken for a cleared one.
  const [saved, setSaved] = useState(startDate ?? "");
  // Changes when Clear empties the field, so the field starts again from empty.
  const [fieldKey, setFieldKey] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  // The date typed and not saved yet. A date field reports every year typed on the way (0002, 0020,
  // 0202, 2026), so a date is saved shortly after typing stops, when the field is left, or on close.
  const typed = useRef<{ value: string; timer?: ReturnType<typeof setTimeout> } | undefined>(undefined);

  // Saves the typed date now; false when that failed. A failed date stays typed, so leaving the
  // field or closing tries again.
  async function flush() {
    const pending = typed.current;
    if (!pending) return true;
    clearTimeout(pending.timer);
    typed.current = undefined;
    if (pending.value === saved) return true;
    const ok = await save(pending.value);
    if (!ok && !typed.current) typed.current = { value: pending.value };
    return ok;
  }

  // Stays open, with the error shown, when the typed date could not be saved.
  async function close() {
    if (await flush()) onClose();
  }

  // Saves the date; false when it could not be saved.
  async function save(next: string | null) {
    setStatus("saving");
    try {
      await onChangeStartDate(next);
      setSaved(next ?? "");
      setStatus("saved");
      return true;
    } catch {
      setStatus("error");
      return false;
    }
  }

  // The field starts again from empty at once, and goes back to the saved date if that failed.
  async function clear() {
    const before = saved;
    setSaved("");
    setFieldKey((key) => key + 1);
    if (!(await save(null))) {
      setSaved(before);
      setFieldKey((key) => key + 1);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(e) => {
        e.preventDefault();
        void close();
      }}
      onClose={onClose}
    >
      <div className="settings-head">
        <h2 id="settings-title">{t("trip.settings")}</h2>
        <span className="panel-status" role="status">
          {status === "saving" && t("generic.saving")}
          {status === "saved" && t("generic.saved")}
        </span>
        <button type="button" className="ib" aria-label={t("generic.close")} title={t("generic.closeEsc")} onClick={() => void close()}>
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
            defaultValue={saved}
            autoFocus
            title={t("trip.pickDate")}
            min={`${MIN_START_YEAR}-01-01`}
            max={`${MAX_START_YEAR}-12-31`}
            onBlur={() => void flush()}
            onChange={(e) => {
              const value = e.target.value;
              clearTimeout(typed.current?.timer);
              // An empty or half-typed field is not a date to save; only Clear removes the date.
              typed.current = startDateSchema.safeParse(value).success ? { value, timer: setTimeout(() => void flush(), SAVE_DELAY_MS) } : undefined;
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={saved === ""}
            onClick={() => {
              clearTimeout(typed.current?.timer);
              typed.current = undefined;
              void clear();
            }}
          >
            {t("trip.clearDate")}
          </button>
        </div>
        <p className="hint">{t("trip.datesHint")}</p>
        {status === "error" && <p role="alert">{t("trip.dateError")}</p>}
      </div>
    </dialog>
  );
}
