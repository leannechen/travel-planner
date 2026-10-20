import type { Trip } from "@travel-planner/shared";
import { Map as MapIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "./preferences";
import { TitleForm } from "./TitleForm";

type Props = {
  trips: Trip[];
  currentId: string | undefined;
  onSwitch: (tripId: string) => void;
  onCreate: (title: string) => Promise<void>;
  onClose: () => void;
  // The session ended: Trips can be looked at, not created.
  readOnly?: boolean;
};

// The list of the user's Trips, opened from the Trip title: pick one to show, or start a new one.
// A modal panel; Escape or the Close button closes it.
export function TripListDialog({ trips, currentId, onSwitch, onCreate, onClose, readOnly }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="trip-list-dialog" aria-labelledby="trip-list-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onClose={onClose}>
      <h2 id="trip-list-title">{t("tripList.title")}</h2>
      <ul>
        {trips.map((trip) => (
          <li key={trip.id}>
            <button type="button" aria-current={trip.id === currentId ? "true" : undefined} onClick={() => onSwitch(trip.id)}>
              <MapIcon size={16} aria-hidden="true" />
              <span className="trip-list-name">{trip.title}</span>
              <span className="trip-list-days">{t("trip.days", { count: trip.days.length })}</span>
            </button>
          </li>
        ))}
      </ul>
      {!readOnly && <TitleForm label={t("app.tripTitle")} submitLabel={t("tripList.new")} onSubmit={onCreate} />}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          {t("generic.close")}
        </button>
      </div>
    </dialog>
  );
}
