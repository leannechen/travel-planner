import { MAX_AI_PROMPT_LENGTH } from "@travel-planner/shared";
import { ChevronLeft, Info, Sparkles, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "./api";
import { usePreferences } from "./preferences";
import type { TripGeneration } from "./tripGeneration";

type Props = {
  generation: TripGeneration;
  onBack: () => void;
  onClose: () => void;
};

const EXAMPLES = ["ai.example1", "ai.example2", "ai.example3"] as const;

// "Generate with AI" in the New Trip dialog (design 24): a prompt, example prompts and the daily
// limit; then the waiting state (design 22), or the limit reached (design 23). The dialog can be
// closed while the Trip is being created; the page says when it is ready.
export function GenerateTripPane({ generation, onBack, onClose }: Props) {
  const { t, language } = usePreferences();
  // A prompt that failed is kept, so it can be tried again.
  const [prompt, setPrompt] = useState(generation.lastPrompt);
  const [busy, setBusy] = useState(false);
  // Why starting failed (the generation's own failure comes from `generation`).
  const [startFailed, setStartFailed] = useState(false);
  const { setWatching } = generation;
  useEffect(() => {
    setWatching(true);
    return () => setWatching(false);
  }, [setWatching]);

  // The Trip was made while this dialog was open: it has done its job, and the prompt goes with it.
  const wasRunning = useRef(generation.running);
  useEffect(() => {
    if (wasRunning.current && !generation.running && !generation.failure) onClose();
    wasRunning.current = generation.running;
  }, [generation.running, generation.failure, onClose]);

  const limitReached =generation.remaining === 0;
  const canGenerate = prompt.trim() !== "" && !busy && !limitReached;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canGenerate) return;
    setBusy(true);
    setStartFailed(false);
    try {
      await generation.start({ prompt: prompt.trim(), language });
    } catch (err) {
      // The limit and a generation already running show as such; anything else is an error.
      if (!(err instanceof ApiError && (err.code === "daily_limit" || err.code === "generation_running"))) setStartFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const close = (
    <button type="button" className="ib" aria-label={t("generic.close")} title={t("generic.closeEsc")} onClick={onClose}>
      <X size={16} aria-hidden="true" />
    </button>
  );

  if (generation.running) {
    return (
      <div className="ai-creating" role="status">
        <div className="settings-head">
          <h2 id="new-trip-title">{t("ai.creating")}</h2>
          {close}
        </div>
        <p className="hint">{t("ai.creatingHint")}</p>
        <div className="ai-skeleton" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("generic.close")}
          </button>
        </div>
      </div>
    );
  }

  const failure = generation.failure === "unusable" ? t("ai.unusable") : generation.failure === "failed" || startFailed ? t("ai.failed") : undefined;
  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="settings-head">
        <Sparkles size={16} className="ai-mark" aria-hidden="true" />
        <h2 id="new-trip-title">{t("newTrip.ai")}</h2>
        {close}
      </div>
      <div className="settings-field">
        <label htmlFor="ai-prompt">{t("ai.describe")}</label>
        <textarea id="ai-prompt" autoFocus rows={4} maxLength={MAX_AI_PROMPT_LENGTH} value={prompt} placeholder={t("ai.placeholder")} onChange={(e) => setPrompt(e.target.value)} />
        <p className="hint">{t("ai.hint")}</p>
      </div>
      <div className="ai-examples">
        {EXAMPLES.map((key) => (
          <button key={key} type="button" className="ai-example" onClick={() => setPrompt(t(key))}>
            {t(key)}
          </button>
        ))}
      </div>
      <p className="hint ai-note">{t("ai.note")}</p>
      {limitReached ? (
        <p className="ai-callout warn" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          {t("ai.limitReached")}
        </p>
      ) : (
        <p className="ai-callout">
          <Info size={14} aria-hidden="true" />
          {t("ai.limitNote")}
        </p>
      )}
      {failure && (
        <p className="hint error" role="alert">
          {failure}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn back" onClick={onBack}>
          <ChevronLeft size={14} aria-hidden="true" />
          {t("generic.back")}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t("generic.cancel")}
        </button>
        <button type="submit" className="btn primary" disabled={!canGenerate}>
          <Sparkles size={14} aria-hidden="true" />
          {t("ai.generate")}
        </button>
      </div>
    </form>
  );
}
