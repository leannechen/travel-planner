import { MAX_START_YEAR, MIN_START_YEAR, startDateSchema, type CreateTripInput, type TravelMode } from "@travel-planner/shared";
import { ChevronLeft, ChevronRight, FileText, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { GenerateTripPane } from "./GenerateTripPane";
import { MODE_ICONS } from "./legFormat";
import { useT } from "./preferences";
import type { TripGeneration } from "./tripGeneration";

const MODES: TravelMode[] = ["drive", "transit", "walk"];

type Props = {
  // Rejects when the Trip could not be created.
  onCreate: (input: CreateTripInput) => Promise<void>;
  onCancel: () => void;
  // AI generation, for a logged-in user only (PRD §7); without it the dialog is the Blank Trip form.
  generation?: TripGeneration;
  // Opens on Generate with AI (trying a failed generation again).
  initialStep?: "ai";
};

// New Trip (design 24): a choice between a Blank Trip (title, optional start date and the default
// travel mode) and Generate with AI. A guest gets the Blank Trip form at once. While a generation
// runs, the dialog opens on it.
export function NewTripDialog({ onCreate, onCancel, generation, initialStep }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"choose" | "blank" | "ai">(() => (!generation ? "blank" : generation.running || initialStep === "ai" ? "ai" : "choose"));
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

  const shell = (content: ReactNode) => (
    <dialog ref={dialog} className="confirm-dialog new-trip-dialog" aria-labelledby="new-trip-title" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }} onClose={onCancel}>
      {content}
    </dialog>
  );

  if (step === "ai" && generation) return shell(<GenerateTripPane generation={generation} onBack={() => setStep("choose")} onClose={onCancel} />);

  if (step === "choose") {
    return shell(
      <>
        <div className="settings-head">
          <h2 id="new-trip-title">{t("newTrip.choose")}</h2>
          <button type="button" className="ib" aria-label={t("generic.close")} title={t("generic.closeEsc")} onClick={onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="new-trip-choices">
          <button type="button" className="new-trip-choice" onClick={() => setStep("blank")}>
            <FileText size={18} aria-hidden="true" />
            <span>
              <strong>{t("newTrip.title")}</strong>
              <small>{t("newTrip.blankHint")}</small>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <button type="button" className="new-trip-choice ai" onClick={() => setStep("ai")}>
            <Sparkles size={18} aria-hidden="true" />
            <span>
              <strong>{t("newTrip.ai")}</strong>
              <small>{t("newTrip.aiHint")}</small>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="hint">{t("newTrip.either")}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t("generic.cancel")}
          </button>
        </div>
      </>,
    );
  }

  return shell(
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
          {generation && (
            <button type="button" className="btn back" disabled={busy} onClick={() => setStep("choose")}>
              <ChevronLeft size={14} aria-hidden="true" />
              {t("generic.back")}
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t("generic.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!canCreate}>
            {t("newTrip.create")}
          </button>
        </div>
      </form>,
  );
}
