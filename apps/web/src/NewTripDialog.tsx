import { MAX_START_YEAR, MIN_START_YEAR, startDateSchema, type CreateTripInput, type TravelMode } from "@travel-planner/shared";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MODE_ICONS } from "./legFormat";
import { useT } from "./preferences";

const MODES: TravelMode[] = ["drive", "transit", "walk"];

type Props = {
  // Rejects when the Trip could not be created.
  onCreate: (input: CreateTripInput) => Promise<void>;
  onCancel: () => void;
};

// A blank Trip: title, optional start date and the default travel mode (design 24, "Blank Trip").
// Generate with AI joins it as a second choice in step 23.
export function NewTripDialog({ onCreate, onCancel }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [mode, setMode] = useState<TravelMode>("transit");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const dateOk = startDate === "" || startDateSchema.safeParse(startDate).success;
  const canCreate = title.trim() !== "" && dateOk && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    setFailed(false);
    try {
      await onCreate({ title: title.trim(), travelMode: mode, startDate: startDate === "" ? null : startDate });
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <dialog ref={dialog} className="confirm-dialog new-trip-dialog" aria-labelledby="new-trip-title" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }} onClose={onCancel}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="settings-head">
          <h2 id="new-trip-title">{t("newTrip.title")}</h2>
          <button type="button" className="ib" aria-label={t("generic.close")} title={t("generic.closeEsc")} disabled={busy} onClick={onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="settings-field">
          <label htmlFor="new-trip-name">{t("app.tripTitle")}</label>
          <input id="new-trip-name" autoFocus value={title} placeholder={t("newTrip.placeholder")} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="settings-field">
          <label htmlFor="new-trip-date">
            {t("trip.startDate")} · {t("trip.optional")}
          </label>
          <input
            id="new-trip-date"
            type="date"
            value={startDate}
            title={t("trip.pickDate")}
            min={`${MIN_START_YEAR}-01-01`}
            max={`${MAX_START_YEAR}-12-31`}
            onChange={(e) => setStartDate(e.target.value)}
          />
          {!dateOk && <p className="hint error">{t("newTrip.dateInvalid", { min: MIN_START_YEAR, max: MAX_START_YEAR })}</p>}
        </div>
        <fieldset className="settings-field new-trip-mode">
          <legend>{t("newTrip.mode")}</legend>
          <div className="segmented">
            {MODES.map((value) => {
              const Icon = MODE_ICONS[value];
              return (
                <label key={value} className={value === mode ? "on" : undefined}>
                  <input type="radio" name="new-trip-mode" value={value} checked={value === mode} onChange={() => setMode(value)} />
                  <Icon size={14} aria-hidden="true" />
                  {t(`leg.${value}`)}
                </label>
              );
            })}
          </div>
          <p className="hint">{t("newTrip.modeHint")}</p>
        </fieldset>
        {failed && <p role="alert">{t("newTrip.error")}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t("generic.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!canCreate}>
            {t("newTrip.create")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
