import {
  legEndpoints,
  legGap,
  legTooShort,
  routeUrl,
  TRAVEL_MODES,
  type Event,
  type Leg,
  type TravelMode,
} from "@travel-planner/shared";
import { Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
export function LegPopover({ anchor, from, to, leg, defaultMode, onCreate, onChangeMode, onDelete, onClose }: Props) {
  const t = useT();
  const phone = useIsPhone();
  const root = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<TravelMode>(defaultMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [position, setPosition] = useState<{ left: number; top: number } | undefined>();
  const mode = leg ? leg.mode : chosen;

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
      onClose();
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
      setError(err instanceof Error ? err.message : t("leg.failed"));
    } finally {
      setBusy(false);
    }
  }

  const gap = legGap(from, to);
  const tooShort = leg ? legTooShort(leg, gap) : false;
  const calculated = leg && leg.durationMinutes !== null;
  const mapLink = calculated && fromPlace && toPlace ? routeUrl(fromPlace, toPlace, leg.mode) : undefined;
  const Icon = MODE_ICONS[mode];
  const title = !leg
    ? t("leg.chooserTitle")
    : calculated
      ? t("leg.title", { duration: formatDuration(leg.durationMinutes!, t) })
      : t("leg.titleNone");
  const noLocation = !fromPlaceId || !toPlaceId;

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
            onClick={() => (leg ? void run(() => onChangeMode(leg, m), false) : setChosen(m))}
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
          <dl className="leg-facts">
            <dt>{t("leg.durationDistance")}</dt>
            <dd>{calculated ? `${formatDuration(leg.durationMinutes!, t)} · ${formatDistance(leg.distanceMeters ?? 0, t)}` : "—"}</dd>
            <dt>{t("leg.gap")}</dt>
            <dd className={tooShort ? "warn" : undefined}>{formatDuration(Math.max(gap, 0), t)}</dd>
          </dl>
          {tooShort && (
            <p className="leg-warning" role="status">
              <TriangleAlert size={14} aria-hidden="true" />
              <span>{t("leg.tooShort", { duration: formatDuration(leg.durationMinutes!, t) })}</span>
            </p>
          )}
          {!calculated && <p className="leg-note">{noLocation ? t("leg.noLocation") : t("leg.noRoute")}</p>}
          {error && <p role="alert" className="leg-error">{error}</p>}
          {mapLink && (
            <a href={mapLink} target="_blank" rel="noreferrer">
              {t("leg.openMaps")}
            </a>
          )}
          <div className="leg-actions">
            <button type="button" className="btn dng-q" disabled={busy} onClick={() => void run(() => onDelete(leg), true)}>
              <Trash2 size={14} aria-hidden="true" />
              {t("leg.delete")}
            </button>
            <span className="leg-saved">{t("event.autosaved")}</span>
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
