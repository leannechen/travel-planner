import { dayWindows, formatWindows, hoursSummary, type OpeningHours } from "@travel-planner/shared";
import { ChevronDown, ChevronUp, Clock, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import type { MessageKey } from "./messages";
import { useT } from "./preferences";

const DAY_KEYS: MessageKey[] = ["opening.day0", "opening.day1", "opening.day2", "opening.day3", "opening.day4", "opening.day5", "opening.day6"];

// Monday first, as the week is listed.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

type Props = {
  // The user turned opening hours on for this Event.
  on: boolean;
  // The hours of the Event's place, when known.
  hours?: OpeningHours;
  // The server is still being asked for the hours of an Event that has them on.
  fetching: boolean;
  // The Event's weekday when it is on a dated Day; undefined without one.
  weekday?: number;
  // Whether the Trip has a start date, which the check needs.
  dated: boolean;
  conflict: boolean;
  // Turns them on; "none" when Google has no hours for the place. Rejects when the request fails.
  onTurnOn: () => Promise<"on" | "none">;
  onRemove: () => Promise<void>;
};

// The Opening hours section of the Event panel (PRD §3.5, design 44): a button to get them from
// Google, then the hours, a note when they may conflict with the Event's time, and a way to remove them.
export function OpeningHoursSection({ on, hours, fetching, weekday, dated, conflict, onTurnOn, onRemove }: Props) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<"none" | "error" | undefined>();
  const [weekOpen, setWeekOpen] = useState(false);

  async function turnOn() {
    setPending(true);
    setNote(undefined);
    try {
      if ((await onTurnOn()) === "none") setNote("none");
    } catch {
      setNote("error");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    try {
      await onRemove();
      setNote(undefined);
      setWeekOpen(false);
    } catch {
      setNote("error");
    } finally {
      setPending(false);
    }
  }

  if (!on || !hours) {
    const busy = pending || (on && fetching);
    return (
      <div className="oh">
        <span className="oh-title">{t("opening.title")}</span>
        <button type="button" className="oh-get" disabled={busy} aria-busy={busy} onClick={() => void turnOn()}>
          {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Clock size={14} aria-hidden="true" />}
          {busy ? t("opening.loading") : t("opening.get")}
        </button>
        {note === "none" && (
          <p className="oh-note" role="status">
            <Info size={14} aria-hidden="true" />
            <span>{t("opening.none")}</span>
          </p>
        )}
        {note === "error" && (
          <p className="oh-note" role="alert">
            <Info size={14} aria-hidden="true" />
            <span>{t("opening.error")}</span>
          </p>
        )}
      </div>
    );
  }

  const summary = hoursSummary(hours);
  const closed = hours.status !== "open";
  const dayText = (day: number) => formatWindows(dayWindows(hours, day)) ?? t("opening.closed");
  // The week is listed straight away without a date (there is no weekday to show), else on request.
  const showWeek = summary.kind === "varies" && (weekday === undefined || weekOpen);
  const line = closed
    ? t(hours.status === "closed-permanently" ? "opening.closedPermanently" : "opening.closedTemporarily")
    : summary.kind === "always"
      ? t("opening.always")
      : summary.kind === "daily"
        ? t("opening.daily", { hours: summary.text })
        : weekday === undefined
          ? t("opening.wholeWeek")
          : t("opening.dayHours", { day: t(DAY_KEYS[weekday]!), hours: dayText(weekday) });

  return (
    <div className="oh">
      <span className="oh-title">{t("opening.title")}</span>
      <div className="oh-line">
        <span className={weekday === undefined && summary.kind === "varies" && !closed ? "oh-src strong" : undefined}>{line}</span>
        <span className="oh-src">{t("opening.source")}</span>
      </div>
      {conflict && (
        <span className="oh-cf" role="status">
          <TriangleAlert size={14} aria-hidden="true" />
          {t("opening.conflict")}
        </span>
      )}
      {showWeek && (
        <div className="oh-wk" id="oh-week">
          {WEEK_ORDER.map((day) => (
            <div key={day} className={[formatWindows(dayWindows(hours, day)) ? "" : "cl", day === weekday ? "now" : ""].filter(Boolean).join(" ") || undefined}>
              <span>{t(DAY_KEYS[day]!)}</span>
              <span>{dayText(day)}</span>
            </div>
          ))}
        </div>
      )}
      {!dated && !closed && (
        <p className="oh-note">
          <Info size={14} aria-hidden="true" />
          <span>{t("opening.needDate")}</span>
        </p>
      )}
      <div className="oh-acts">
        {summary.kind === "varies" && !closed && weekday !== undefined ? (
          <button type="button" className="oh-link" aria-expanded={weekOpen} aria-controls="oh-week" onClick={() => setWeekOpen(!weekOpen)}>
            {t("opening.wholeWeek")}
            {weekOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="oh-link rm" disabled={pending} onClick={() => void remove()}>
          <X size={14} aria-hidden="true" />
          {t("opening.remove")}
        </button>
      </div>
      {note === "error" && (
        <p className="oh-note" role="alert">
          <Info size={14} aria-hidden="true" />
          <span>{t("opening.error")}</span>
        </p>
      )}
    </div>
  );
}
