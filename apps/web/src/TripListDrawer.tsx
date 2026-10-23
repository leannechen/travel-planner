import { MAX_BACKUP_BYTES, type CreateTripInput, type Trip } from "@travel-planner/shared";
import { Download, Ellipsis, Map as MapIcon, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { DeleteTripDialog } from "./DeleteTripDialog";
import { NewTripDialog } from "./NewTripDialog";
import { useIsPhone } from "./phone";
import { useT } from "./preferences";
import { RenameTripDialog } from "./RenameTripDialog";
import type { TripGeneration } from "./tripGeneration";

type Props = {
  trips: Trip[];
  currentId: string | undefined;
  onSwitch: (tripId: string) => void;
  onCreate: (input: CreateTripInput) => Promise<void>;
  // Rename and delete are the Owner's; both reject when the server refused.
  onRename: (tripId: string, title: string) => Promise<void>;
  onDelete: (tripId: string) => Promise<void>;
  // Saves the Trip's full backup as a file, and makes a new Trip from a backup file (it opens that
  // Trip); both reject when that failed.
  onExport: (tripId: string) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onOpenSettings: (tripId: string) => void;
  onShare: (tripId: string) => void;
  onClose: () => void;
  // The session ended: Trips can be looked at, not changed.
  readOnly?: boolean;
  // AI generation for a logged-in user (step 23); New Trip then offers it first.
  generation?: TripGeneration;
};

// The Trip list (design 24, 27): a drawer over the Backlog opened from the Trip title, a full screen
// on a phone. Pick a Trip to show it, start a new one, or use a Trip's "⋯" menu. Escape, the close
// button or a click outside closes it. Pinning the drawer open (design 27, C) is not done.
export function TripListDrawer({ trips, currentId, onSwitch, onCreate, onRename, onDelete, onExport, onImport, onOpenSettings, onShare, onClose, readOnly, generation }: Props) {
  const t = useT();
  const phone = useIsPhone();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  // The Trip whose "⋯" menu is open, the one being renamed, the one asked about deleting, and
  // whether the New Trip dialog is open.
  const [menuId, setMenuId] = useState<string | undefined>();
  const [renaming, setRenaming] = useState<Trip | undefined>();
  const [deleting, setDeleting] = useState<Trip | undefined>();
  const [creating, setCreating] = useState(false);
  // Why the last export or import failed, and whether an import is running.
  const [problem, setProblem] = useState<string | undefined>();
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function exportTrip(trip: Trip) {
    setProblem(undefined);
    try {
      await onExport(trip.id);
    } catch {
      setProblem(t("tripList.exportError"));
    }
  }

  async function importFile(file: File) {
    setProblem(undefined);
    if (file.size > MAX_BACKUP_BYTES) {
      setProblem(t("tripList.importTooLarge"));
      return;
    }
    setImporting(true);
    try {
      await onImport(file);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setProblem(t(code === "invalid_backup" ? "tripList.importInvalid" : code === "backup_too_large" ? "tripList.importTooLarge" : "tripList.importError"));
      setImporting(false);
    }
  }

  // The "⋯" menu closes on Escape (taken first, so the drawer stays) and on a click outside it.
  useEffect(() => {
    if (!menuId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setMenuId(undefined);
    };
    const onPointer = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".trip-menu, .trip-item-menu")) setMenuId(undefined);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [menuId]);

  const own = trips.filter((trip) => trip.role === "owner");
  const shared = trips.filter((trip) => trip.role === "editor");

  const row = (trip: Trip) => {
    const owner = trip.role === "owner";
    return (
      <li key={trip.id} className={`trip-item${trip.id === currentId ? " on" : ""}`}>
        <button type="button" className="trip-item-main" aria-current={trip.id === currentId ? "true" : undefined} onClick={() => onSwitch(trip.id)}>
          <MapIcon size={16} aria-hidden="true" />
          <span className="trip-item-text">
            <span className="trip-item-name">{trip.title}</span>
            <span className="trip-item-days">{t("trip.days", { count: trip.days.length })}</span>
          </span>
        </button>
        <button type="button" className="ib trip-item-menu" aria-label={t("tripList.menu", { title: trip.title })} aria-expanded={menuId === trip.id} onClick={() => { setMenuId(menuId === trip.id ? undefined : trip.id); }}>
          <Ellipsis size={16} aria-hidden="true" />
        </button>
        {menuId === trip.id && (
          <div className="trip-menu">
            {owner && !readOnly && (
              <button type="button" onClick={() => { setMenuId(undefined); setRenaming(trip); }}>
                {t("tripList.rename")}
              </button>
            )}
            <button type="button" onClick={() => { setMenuId(undefined); onOpenSettings(trip.id); }}>
              {t("trip.settings")}
            </button>
            {owner && !readOnly && (
              <button type="button" onClick={() => { setMenuId(undefined); onShare(trip.id); }}>
                {t("tripList.share")}
              </button>
            )}
            {!readOnly && (
              <button type="button" onClick={() => { setMenuId(undefined); void exportTrip(trip); }}>
                <Download size={14} aria-hidden="true" />
                {t("tripList.export")}
              </button>
            )}
            {owner && !readOnly && (
              <>
                <hr />
                <button type="button" className="danger-text" onClick={() => { setMenuId(undefined); setDeleting(trip); }}>
                  <Trash2 size={14} aria-hidden="true" />
                  {t("tripList.delete")}
                </button>
              </>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <dialog
        ref={dialog}
        className="trip-list-drawer"
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
          {phone && !readOnly && (
            <button type="button" className="btn primary sm" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" />
              {t("tripList.newShort")}
            </button>
          )}
          <button type="button" className="ib" aria-label={t("generic.close")} title={t("generic.closeEsc")} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {!phone && !readOnly && (
          <button type="button" className="btn primary trip-list-new" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            {t("tripList.new")}
          </button>
        )}
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
        {!readOnly && (
          <div className="trip-list-foot">
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              data-testid="backup-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importFile(file);
              }}
            />
            <button type="button" className="btn" disabled={importing} onClick={() => fileInput.current?.click()}>
              <Upload size={14} aria-hidden="true" />
              {importing ? t("tripList.importing") : t("tripList.import")}
            </button>
            <p className="trip-list-hint">{t("tripList.importHint")}</p>
          </div>
        )}
        {problem && <p role="alert" className="trip-list-problem">{problem}</p>}
        </div>
      </dialog>
      {renaming && <RenameTripDialog title={renaming.title} onClose={() => setRenaming(undefined)} onRename={(title) => onRename(renaming.id, title)} />}
      {creating && <NewTripDialog generation={generation} onCancel={() => setCreating(false)} onCreate={async (input) => { await onCreate(input); setCreating(false); }} />}
      {deleting && (
        <DeleteTripDialog
          trip={deleting}
          onCancel={() => setDeleting(undefined)}
          onDelete={async () => {
            await onDelete(deleting.id);
            setDeleting(undefined);
          }}
        />
      )}
    </>
  );
}
