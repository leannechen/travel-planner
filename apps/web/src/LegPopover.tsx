import {
  legEndpoints,
  legGap,
  legTooShort,
  MAX_MANUAL_LEG_MINUTES,
  routeUrl,
  TRAVEL_MODES,
  type Event,
  type Leg,
  type TravelMode,
} from "@travel-planner/shared";
import { Info, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "./api";
import { formatDistance, formatDuration, MODE_ICONS, modeKey } from "./legFormat";
import { usePlace } from "./placeCache";
import { useIsPhone } from "./phone";
import { useT } from "./preferences";

type Props = {
  // The element the popover points at (the slot or the Leg on the timeline).
  anchor: HTMLElement;
  from: Event;
  to: Event;
  // The Leg being shown; absent while the user is choosing the mode of a new one.
  leg?: Leg;
  defaultMode: TravelMode;
  onCreate: (mode: TravelMode) => Promise<unknown>;
  onChangeMode: (leg: Leg, mode: TravelMode) => Promise<unknown>;
  // Gives a Leg that cannot be calculated a duration entered by hand, or clears it (null; ADR 0009).
  onSetDuration: (leg: Leg, durationMinutes: number | null) => Promise<unknown>;
  onDelete: (leg: Leg) => Promise<unknown>;
  onClose: () => void;
};

const WIDTH = 300;
const MARGIN = 8;

// Where the popover goes on desktop: beside the anchor, kept inside the window.
function placeBeside(anchor: DOMRect, height: number) {
  const roomRight = window.innerWidth - anchor.right;
  const left = roomRight >= WIDTH + MARGIN * 2 ? anchor.right + MARGIN : Math.max(MARGIN, anchor.left - WIDTH - MARGIN);
  const top = Math.min(Math.max(MARGIN, anchor.top - 8), Math.max(MARGIN, window.innerHeight - height - MARGIN));
  return { left, top };
}

// The chooser for a new Leg (travel mode, Cancel and OK) and the detail of an existing one (PRD §3.3).
// On phone it is a bottom sheet.
export function LegPopover({ anchor, from, to, leg, defaultMode, onCreate, onChangeMode, onSetDuration, onDelete, onClose }: Props) {
  const t = useT();
  const phone = useIsPhone();
  const root = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<TravelMode>(defaultMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [position, setPosition] = useState<{ left: number; top: number } | undefined>();
  const mode = leg ? leg.mode : chosen;
  // Editing a duration entered by hand (designs 25b, 25c): the field's text and why it was refused.
  const [editingChosen, setEditing] = useState(false);
  // Only a duration entered by hand is edited: once the Leg is calculated (its mode or a place
  // changed, here or in another session) the edit is over.
  const editing = editingChosen && Boolean(leg?.manual);
  const [minutes, setMinutes] = useState("");
  const [minutesError, setMinutesError] = useState<string | undefined>();
  const [tipOpen, setTipOpen] = useState(false);
  // What Esc closes first: the "Entered by you" tip, then the edit, then the popover.
  const escapeRef = useRef({ editing, tipOpen });
  escapeRef.current = { editing, tipOpen };
  const editButton = useRef<HTMLButtonElement>(null);
  const minutesInput = useRef<HTMLInputElement>(null);

  const { fromPlaceId, toPlaceId } = legEndpoints(from, to);
  const fromPlace = usePlace(fromPlaceId ?? "").place;
  const toPlace = usePlace(toPlaceId ?? "").place;

  // Follows the anchor while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (phone) return;
    const measure = () => {
      if (!anchor.isConnected || !root.current) return;
      setPosition(placeBeside(anchor.getBoundingClientRect(), root.current.offsetHeight));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor, phone, leg]);

  // Esc closes this and nothing else; a click elsewhere closes it too. Focus goes back to where
  // it came from.
  useEffect(() => {
    const first = root.current?.querySelector<HTMLElement>("[aria-pressed='true']");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      // While a duration is being edited, Esc goes back to it as it was.
      if (escapeRef.current.tipOpen) setTipOpen(false);
      else if (escapeRef.current.editing) stopEditing();
      else onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!root.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      if (anchor.isConnected) anchor.focus();
    };
  }, [anchor, onClose]);

  async function run(action: () => Promise<unknown>, closeAfter: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      if (closeAfter) onClose();
    } catch (err) {
      // Another session had the Leg calculated meanwhile, so it takes no duration by hand any more.
      if (err instanceof ApiError && err.code === "leg_calculated") setError(t("leg.calculatedMeanwhile"));
      else setError(err instanceof Error ? err.message : t("leg.failed"));
    } finally {
      setBusy(false);
    }
  }

  function stopEditing() {
    setEditing(false);
    setMinutesError(undefined);
    setTimeout(() => editButton.current?.focus());
  }

  function startEditing(current: number) {
    setMinutes(String(current));
    setMinutesError(undefined);
    setEditing(true);
  }

  // Saves the minutes typed; a number outside 1 to 1,440 is refused under the field, keeping the old value.
  function saveMinutes(target: Leg) {
    const value = minutes.trim();
    const n = Number(value);
    if (!/^\d+$/.test(value) || n < 1 || n > MAX_MANUAL_LEG_MINUTES) {
      setMinutesError(t("leg.durationInvalid"));
      return;
    }
    setMinutesError(undefined);
    void run(async () => {
      await onSetDuration(target, n);
      setEditing(false);
      setMinutes("");
      // The field goes; focus moves to Edit, which brings it back.
      setTimeout(() => editButton.current?.focus());
    }, false);
  }

  const gap = legGap(from, to);
  const tooShort = leg ? legTooShort(leg, gap) : false;
  const calculated = leg && leg.durationMinutes !== null;
  const manual = leg?.manual ?? false;
  // Google Maps shows routes the Routes API does not (transit in Japan), so the user can look the trip
  // up there; the link is there whenever both places are known.
  const mapLink = leg && fromPlace && toPlace ? routeUrl(fromPlace, toPlace, leg.mode) : undefined;
  const Icon = MODE_ICONS[mode];
  const title = !leg
    ? t("leg.chooserTitle")
    : calculated
      ? t("leg.title", { duration: formatDuration(leg.durationMinutes!, t) })
      : t("leg.titleNone");
  const noLocation = !fromPlaceId || !toPlaceId;
  // A Leg between two places that Google could not calculate takes a duration by hand (ADR 0009).
  const takesDuration = Boolean(leg) && !noLocation && (!calculated || manual);

  // The minutes field (designs 25b, 25c): Save, and while editing a duration already entered, Cancel
  // and Clear duration.
  const durationField = (target: Leg, editingEntered: boolean) => {
    const hintId = `leg-minutes-hint-${target.id}`;
    return (
      <form
        className="leg-duration"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          saveMinutes(target);
        }}
      >
        <label className="leg-label" htmlFor={`leg-minutes-${target.id}`}>
          {t("leg.durationField")}
        </label>
        <div className="leg-duration-row">
          <input
            ref={minutesInput}
            id={`leg-minutes-${target.id}`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoFocus={editingEntered}
            placeholder={t("leg.durationPlaceholder")}
            aria-describedby={hintId}
            aria-invalid={minutesError ? true : undefined}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
          <button type="submit" className="btn pri" disabled={busy}>
            {t("generic.save")}
          </button>
          {editingEntered && (
            <button type="button" className="btn" disabled={busy} onClick={stopEditing}>
              {t("generic.cancel")}
            </button>
          )}
        </div>
        {minutesError ? (
          <p id={hintId} className="leg-field-error" role="alert">
            {minutesError}
          </p>
        ) : (
          <p id={hintId} className="leg-hint">
            {t("leg.durationHint")}
          </p>
        )}
        {editingEntered && (
          <button
            type="button"
            className="btn sm ghost leg-clear"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onSetDuration(target, null);
                setEditing(false);
                setMinutes("");
                // Back to the empty field, ready for another number.
                setTimeout(() => minutesInput.current?.focus());
              }, false)
            }
          >
            {t("leg.clearDuration")}
          </button>
        )}
      </form>
    );
  };

  const modes = (
    <div className="seg" role="group" aria-label={t("leg.mode")}>
      {TRAVEL_MODES.map((m) => {
        const ModeIcon = MODE_ICONS[m];
        return (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            disabled={busy}
            // The mode the Leg already has is not asked for again: that would drop a duration entered by hand.
            onClick={() => (leg ? m !== leg.mode && void run(() => onChangeMode(leg, m), false) : setChosen(m))}
          >
            <ModeIcon size={14} aria-hidden="true" />
            {t(modeKey(m))}
          </button>
        );
      })}
    </div>
  );

  const body = (
    <div
      ref={root}
      role="dialog"
      aria-label={title}
      className={phone ? "leg-popover sheet" : "leg-popover"}
      style={phone ? undefined : position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
    >
      {phone && <div className="sheet-handle" aria-hidden="true" />}
      <h3>
        {leg && !calculated ? <TriangleAlert size={16} aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
        {title}
      </h3>
      {!leg ? (
        <>
          {modes}
          {error && <p role="alert" className="leg-error">{error}</p>}
          <div className="leg-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t("generic.cancel")}
            </button>
            <button type="button" className="btn pri" disabled={busy} onClick={() => void run(() => onCreate(chosen), true)}>
              {busy ? t("leg.saving") : t("leg.ok")}
            </button>
          </div>
        </>
      ) : (
        <>
          <dl className="leg-facts">
            <dt>{t("leg.from")}</dt>
            <dd>{from.title}</dd>
            <dt>{t("leg.to")}</dt>
            <dd>{to.title}</dd>
          </dl>
          <p className="leg-label">{t("leg.mode")}</p>
          {modes}
          {manual && !editing ? (
            <dl className="leg-facts">
              <dt className="leg-duration-label">
                {t("leg.duration")}
                <span className="leg-info">
                  <button type="button" className="ib" aria-label={t("leg.aboutDuration")} aria-describedby={`leg-tip-${leg.id}`} onClick={() => setTipOpen(!tipOpen)} onBlur={() => setTipOpen(false)}>
                    <Info size={13} aria-hidden="true" />
                  </button>
                  <span id={`leg-tip-${leg.id}`} role="tooltip" className={tipOpen ? "leg-tip open" : "leg-tip"}>
                    {t("leg.enteredByYou")}
                  </span>
                </span>
              </dt>
              <dd className="leg-duration-value">
                {formatDuration(leg.durationMinutes!, t)}
                <button ref={editButton} type="button" className="btn sm" aria-label={t("leg.editDuration")} disabled={busy} onClick={() => startEditing(leg.durationMinutes!)}>
                  {t("leg.edit")}
                </button>
              </dd>
              <dt>{t("leg.distance")}</dt>
              <dd>—</dd>
              <dt>{t("leg.gap")}</dt>
              <dd className={tooShort ? "warn" : undefined}>{formatDuration(Math.max(gap, 0), t)}</dd>
            </dl>
          ) : manual ? (
            <>
              {durationField(leg, true)}
              <dl className="leg-facts">
                <dt>{t("leg.distance")}</dt>
                <dd>—</dd>
                <dt>{t("leg.gap")}</dt>
                <dd className={tooShort ? "warn" : undefined}>{formatDuration(Math.max(gap, 0), t)}</dd>
              </dl>
            </>
          ) : (
            <>
              <dl className="leg-facts">
                <dt>{t("leg.durationDistance")}</dt>
                <dd>{calculated ? `${formatDuration(leg.durationMinutes!, t)} · ${formatDistance(leg.distanceMeters ?? 0, t)}` : "—"}</dd>
                {calculated && (
                  <>
                    <dt>{t("leg.gap")}</dt>
                    <dd className={tooShort ? "warn" : undefined}>{formatDuration(Math.max(gap, 0), t)}</dd>
                  </>
                )}
              </dl>
              {/* https://developers.google.com/maps/faq#transit_directions_countries */}
              {!calculated && <p className="leg-note">{noLocation ? t("leg.noLocation") : mode === "transit" ? t("leg.noTransit") : t("leg.noRoute")}</p>}
              {takesDuration && mapLink && (
                <a href={mapLink} target="_blank" rel="noreferrer">
                  {t("leg.openMaps")}
                </a>
              )}
              {takesDuration && durationField(leg, false)}
              {!calculated && (
                <dl className="leg-facts">
                  <dt>{t("leg.gap")}</dt>
                  <dd>{formatDuration(Math.max(gap, 0), t)}</dd>
                </dl>
              )}
            </>
          )}
          {tooShort && (
            <p className="leg-warning" role="status">
              <TriangleAlert size={14} aria-hidden="true" />
              <span>{t(manual ? "leg.tooShortManual" : "leg.tooShort", { duration: formatDuration(leg.durationMinutes!, t) })}</span>
            </p>
          )}
          {error && <p role="alert" className="leg-error">{error}</p>}
          {mapLink && !(takesDuration && !calculated) && (
            <a href={mapLink} target="_blank" rel="noreferrer">
              {t("leg.openMaps")}
            </a>
          )}
          <div className="leg-actions">
            <button type="button" className="btn dng-q" disabled={busy} onClick={() => void run(() => onDelete(leg), true)}>
              <Trash2 size={14} aria-hidden="true" />
              {t("leg.delete")}
            </button>
            {!takesDuration && <span className="leg-saved">{t("event.autosaved")}</span>}
          </div>
        </>
      )}
    </div>
  );

  return createPortal(
    phone ? (
      <>
        <div className="sheet-scrim" aria-hidden="true" onClick={onClose} />
        {body}
      </>
    ) : (
      body
    ),
    document.body,
  );
}
