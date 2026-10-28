import type { CreateTripInput, Trip } from "@travel-planner/shared";
import { Map as MapIcon, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NewTripDialog } from "./NewTripDialog";
import { useIsPhone } from "./phone";
import { useT } from "./preferences";
import type { TripGeneration } from "./tripGeneration";

type Props = {
  trips: Trip[];
  currentId: string | undefined;
  onSwitch: (tripId: string) => void;
  onCreate: (input: CreateTripInput) => Promise<void>;
  // Makes a new Trip from a backup file (it opens that Trip); rejects when that failed.
  onImport: (file: File) => Promise<void>;
  // Only accounts import: for a guest, Import backup… calls this (to log in) instead of asking for a file.
  onImportLogin?: () => void;
  onClose: () => void;
  // The session ended: Trips can be looked at, not changed.
  readOnly?: boolean;
  // AI generation for a logged-in user (step 23); New Trip then offers it first.
  generation?: TripGeneration;
};

// My Trips (design 24, 27): a modal opened from the Trip title, a bottom sheet on a phone. A row has
// one action, opening that Trip; renaming, deleting, sharing and exporting live in the open Trip's
// dialogs, and importing a backup in New Trip. Escape, the close button or a click outside closes it.
export function TripListDialog({ trips, currentId, onSwitch, onCreate, onImport, onImportLogin, onClose, readOnly, generation }: Props) {
  const t = useT();
  const phone = useIsPhone();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const [creating, setCreating] = useState(false);

  const own = trips.filter((trip) => trip.role === "owner");
  const shared = trips.filter((trip) => trip.role === "editor");

  const row = (trip: Trip) => {
    const current = trip.id === currentId;
    return (
      <li key={trip.id} className={`trip-item${current ? " on" : ""}`}>
        <button type="button" className="trip-item-main" aria-current={current ? "true" : undefined} onClick={() => onSwitch(trip.id)}>
          <MapIcon size={16} aria-hidden="true" />
          <span className="trip-item-text">
            <span className="trip-item-name">{trip.title}</span>
            <span className="trip-item-days">{t("trip.days", { count: trip.days.length })}</span>
          </span>
          {current && <span className="trip-item-current">{t("tripList.current")}</span>}
        </button>
      </li>
    );
  };

  // While New Trip is open the list is not: it comes back when New Trip is cancelled (design 24).
  return (
    <>
      {!creating && (
      <dialog
        ref={dialog}
        className="trip-list-dialog"
        aria-labelledby="trip-list-title"
        onCancel={(e) => {
          e.preventDefault();
          onClose();
        }}
        onClose={onClose}
        // The content fills the dialog, so a click on the dialog element itself is on the backdrop.
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="trip-list-body">
          {phone && <div className="sheet-handle" aria-hidden="true" />}
          <div className="trip-list-head">
            <h2 id="trip-list-title">{t("tripList.title")}</h2>
            {!readOnly && (
              <button type="button" className="btn primary" onClick={() => setCreating(true)}>
                <Plus size={14} aria-hidden="true" />
                {t("tripList.new")}
              </button>
            )}
            <button type="button" className="ib" aria-label={t("generic.close")} title={t("generic.closeEsc")} onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="trip-list-section">
            {t("tripList.mine")} · {own.length}
          </div>
          <ul>{own.map(row)}</ul>
          {shared.length > 0 && (
            <>
              <div className="trip-list-section">
                {t("tripList.shared")} · {shared.length}
              </div>
              <ul>{shared.map(row)}</ul>
            </>
          )}
          {!phone && <p className="trip-list-hint">{t("tripList.hint")}</p>}
        </div>
      </dialog>
      )}
      {creating && (
        <NewTripDialog
          generation={generation}
          onCancel={() => setCreating(false)}
          onCreate={async (input) => { await onCreate(input); setCreating(false); }}
          onImport={async (file) => { await onImport(file); setCreating(false); }}
          onImportLogin={onImportLogin}
        />
      )}
    </>
  );
}
