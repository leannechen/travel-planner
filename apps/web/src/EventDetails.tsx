import { formatMinute, isWebUrl, showsContact, showsOpeningHours, weekdayOf, type Day, type Event } from "@travel-planner/shared";
import { X } from "lucide-react";
import { useEffect } from "react";
import { EnlargeableImage, useEventImageUrl } from "./eventImage";
import { KindIcon, kindKey } from "./kinds";
import { eventConflicts, useOpeningHours } from "./openingHours";
import { OpeningHoursSection } from "./OpeningHoursSection";
import { usePlace } from "./placeCache";
import { useT } from "./preferences";
import { useIsPhone } from "./phone";
import { dayLabel } from "./tripDates";

type Props = {
  event: Event;
  days: Day[];
  startDate: string | undefined;
  onClose: () => void;
};

// A place by its id: name and address, or a note when it cannot be shown.
function PlaceLine({ label, id }: { label: string; id: string }) {
  const t = useT();
  const { place, status } = usePlace(id);
  if (!id) return null;
  return (
    <div className="viewer-field">
      <span>{label}</span>
      {place ? (
        <p>
          <strong>{place.name}</strong>
          <br />
          {place.address}
        </p>
      ) : (
        <p>{status === "loading" ? "…" : t("viewer.placeUnknown")}</p>
      )}
    </div>
  );
}

// An Event opened by a Viewer (design 18): the same facts as the Event panel, as plain text, with
// nothing to change. Contact fields stay visible to Viewers (PRD §8).
export function EventDetails({ event, days, startDate, onClose }: Props) {
  const t = useT();
  const phone = useIsPhone();
  // Esc closes the panel from anywhere on the page, as in the workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const imageUrl = useEventImageUrl(event);
  const { hours, loading } = useOpeningHours(event.openingHoursOn && event.placeId ? [event.placeId] : []);
  const day = event.dayId ? days.find((d) => d.id === event.dayId) : undefined;
  const dated = day && startDate ? dayLabel(startDate, day.position) : undefined;

  const end = event.startMinute + event.durationMinutes;
  const time = (minute: number) => `${formatMinute(minute % 1440)}${minute >= 1440 ? " +1" : ""}`;
  let when: string;
  if (day) {
    const range =
      event.kind === "lodging"
        ? `${t("event.nights")}: ${event.nights ?? 1}${event.checkInMinute !== null ? ` · ${formatMinute(event.checkInMinute)}` : ""}${event.checkOutMinute !== null ? ` – ${formatMinute(event.checkOutMinute)}` : ""}`
        : `${time(event.startMinute)} – ${time(end)}`;
    when = `${t("viewer.when", { day: day.position, time: range })}${dated ? ` · ${dated.short}` : ""}`;
  } else {
    when = t(event.holding === "archive" ? "viewer.archiveWhen" : "viewer.backlogWhen");
  }

  const website = event.website?.trim() ?? "";
  const booking = event.bookingUrl?.trim() ?? "";
  const dayPosition = day?.position;

  return (
    <>
      {phone && <div className="sheet-scrim" onClick={onClose} />}
      <aside className="event-panel viewer-details" aria-label={t("event.panel")}>
        {phone && <div className="sheet-handle" aria-hidden="true" />}
        <div className="panel-head">
          <span className="viewer-kind">
            <KindIcon kind={event.kind} transportLabel={event.transportLabel} />
            {t(kindKey(event.kind))}
          </span>
          <div className="panel-tools">
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t("viewer.close")} title={t("generic.closeEsc")}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="panel-body viewer-body">
          <h2>{event.title}</h2>
          <p className="viewer-when">{when}</p>
          {imageUrl && <EnlargeableImage className="viewer-image" src={imageUrl} alt={event.title} label={t("image.enlarge")} />}
          {event.kind === "transport" ? (
            <>
              <PlaceLine label={t("place.from")} id={event.placeId ?? ""} />
              <PlaceLine label={t("place.to")} id={event.destinationId ?? ""} />
            </>
          ) : (
            <PlaceLine label={t("place.location")} id={event.placeId ?? ""} />
          )}
          {event.description && (
            <div className="viewer-field">
              <span>{t("event.description")}</span>
              <p className="viewer-text">{event.description}</p>
            </div>
          )}
          {showsContact(event.kind) && (event.phone || event.email || website) && (
            <div className="viewer-field">
              <span>{t("event.contact")}</span>
              {event.phone && (
                <p>
                  {t("event.phone")}: <a href={`tel:${event.phone}`}>{event.phone}</a>
                </p>
              )}
              {event.email && (
                <p>
                  {t("event.email")}: <a href={`mailto:${event.email}`}>{event.email}</a>
                </p>
              )}
              {website && (
                <p>
                  {t("event.website")}: {isWebUrl(website) ? <a href={website} target="_blank" rel="noreferrer">{website}</a> : website}
                </p>
              )}
            </div>
          )}
          {booking && (
            <div className="viewer-field">
              <span>{t("event.bookingLink")}</span>
              <p>{isWebUrl(booking) ? <a href={booking} target="_blank" rel="noreferrer">{booking}</a> : booking}</p>
            </div>
          )}
          {event.placeId && showsOpeningHours(event.kind) && (
            <OpeningHoursSection
              readOnly
              on={event.openingHoursOn}
              hours={hours.get(event.placeId)}
              fetching={loading}
              weekday={startDate && dayPosition !== undefined ? weekdayOf(startDate, dayPosition) : undefined}
              dated={startDate !== undefined}
              conflict={eventConflicts(event, dayPosition, startDate, hours)}
              onSetDate={() => undefined}
              onTurnOn={async () => "none"}
              onRemove={async () => undefined}
            />
          )}
        </div>
      </aside>
    </>
  );
}
