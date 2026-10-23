import { allEvents, type Trip } from "@travel-planner/shared";
import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useT } from "./preferences";

type Props = {
  trip: Trip;
  // Rejects when the Trip could not be deleted.
  onDelete: () => Promise<void>;
  onCancel: () => void;
};

// Deleting a Trip asks for its title to be typed, and says what is lost (PRD §8.1, design 24).
export function DeleteTripDialog({ trip, onDelete, onCancel }: Props) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const matches = typed.trim() === trip.title;

  async function confirm() {
    if (!matches || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onDelete();
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <ConfirmDialog title={t("tripDelete.title", { title: trip.title })} confirmLabel={t("tripDelete.confirm")} confirmDisabled={!matches || busy} onConfirm={() => void confirm()} onCancel={onCancel}>
      <p>{t("tripDelete.body", { events: t("count.event", { count: allEvents(trip).length }) })}</p>
      <p className="trip-delete-tip">{t("tripDelete.tip")}</p>
      <label className="trip-delete-confirm">
        {t("tripDelete.type")}
        <input value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void confirm()} />
      </label>
      {failed && <p role="alert">{t("tripDelete.error")}</p>}
    </ConfirmDialog>
  );
}
