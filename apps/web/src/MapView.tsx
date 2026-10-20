import { formatMinute, mapPlan, type Trip } from "@travel-planner/shared";
import { useState } from "react";
import { FakeMapSurface } from "./FakeMapSurface";
import { GOOGLE_MAPS_BROWSER_KEY, GoogleMapSurface } from "./GoogleMapSurface";
import { formatDuration } from "./HoldingAreas";
import { kindKey } from "./kinds";
import { dayColorVar, type PlacedLine, type PlacedMarker } from "./mapPins";
import { usePlaces } from "./placeCache";
import { useT } from "./preferences";

type Props = {
  trip: Trip;
  selectedEventId?: string;
  onSelectEvent: (eventId: string) => void;
};

// The Map View (PRD §6): Event places on a map, colored by Day. Selecting a marker or a list row
// opens the same Event panel as the time axis; nothing is edited here.
export function MapView({ trip, selectedEventId, onSelectEvent }: Props) {
  const t = useT();
  const [chosenDayId, setChosenDayId] = useState<string | null>(null);
  const [showBacklog, setShowBacklog] = useState(true);
  const [showDayLines, setShowDayLines] = useState(true);
  const [fitCount, setFitCount] = useState(0);
  // A Day that was deleted meanwhile counts as "All days".
  const dayId = chosenDayId && trip.days.some((d) => d.id === chosenDayId) ? chosenDayId : null;

  const plan = mapPlan(trip, { dayId, showBacklog, showDayLines });
  const { places, failed } = usePlaces(plan.markers.map((m) => m.placeId));

  const labelOf = (marker: PlacedMarker["marker"], name: string) => {
    const { event } = marker;
    if (marker.role === "departure") return t("map.departs", { name, time: formatMinute(event.startMinute) });
    if (marker.dayPosition === null) return `${event.title} · ${t("area.backlog")}`;
    return `${event.title} · ${t("day.title", { n: marker.dayPosition })} · ${formatMinute(event.startMinute)}`;
  };

  // Markers whose place is not known (yet) are left out rather than drawn at a guess.
  const markers: PlacedMarker[] = plan.markers.flatMap((marker) => {
    const place = places.get(marker.placeId);
    return place ? [{ marker, place, label: labelOf(marker, place.name) }] : [];
  });
  const lines: PlacedLine[] = plan.lines.flatMap((line) => {
    const from = places.get(line.from.placeId);
    const to = places.get(line.to.placeId);
    return from && to ? [{ line, from, to }] : [];
  });

  const fitKey = `${dayId ?? "all"}:${showBacklog}:${fitCount}`;
  const surfaceProps = { markers, lines, selectedEventId, onSelect: onSelectEvent, fitKey };
  const total = plan.groups.reduce((sum, g) => sum + g.events.length, 0);

  return (
    <div className="map-view">
      <aside className="map-list" aria-label={t("map.eventsOnMap")}>
        <header>
          <h3>{t("map.eventsOnMap")}</h3>
          <button type="button" onClick={() => setFitCount((n) => n + 1)}>
            {t("map.fitAll")}
          </button>
        </header>
        {total === 0 && <p className="map-empty">{t("map.empty")}</p>}
        {plan.groups.map((group) => (
          <section key={group.dayId ?? "backlog"} className="map-group" style={{ ["--pin" as string]: dayColorVar(group.position) }}>
            <h4>
              <span className={group.position === null ? "map-swatch backlog" : "map-swatch"} aria-hidden="true" />
              {group.position === null ? t("area.backlog") : t("day.title", { n: group.position })}
              <span className="count">{group.events.length}</span>
            </h4>
            <ul>
              {group.events.map(({ event, order }) => (
                <li key={event.id}>
                  <button type="button" className={event.id === selectedEventId ? "map-row selected" : "map-row"} aria-pressed={event.id === selectedEventId} onClick={() => onSelectEvent(event.id)}>
                    <span className={order === null ? "map-pin-dot backlog" : "map-pin-dot"} aria-hidden="true">
                      {order}
                    </span>
                    <span>
                      <strong>{event.title}</strong>
                      <small>
                        {event.dayId === null
                          ? `${formatDuration(event.durationMinutes, t)} · ${t(kindKey(event.kind))}`
                          : `${formatMinute(event.startMinute)} · ${t(kindKey(event.kind))}`}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </aside>
      <div className="map-stage">
        <div className="map-filters" role="group" aria-label={t("map.filter")}>
          <button type="button" className="map-chip" aria-pressed={dayId === null} onClick={() => setChosenDayId(null)}>
            {t("map.allDays")}
          </button>
          {trip.days.map((day) => (
            <button
              key={day.id}
              type="button"
              className="map-chip"
              style={{ ["--pin" as string]: dayColorVar(day.position) }}
              aria-pressed={dayId === day.id}
              onClick={() => setChosenDayId(day.id)}
            >
              <span className="map-swatch" aria-hidden="true" />
              {t("day.title", { n: day.position })}
            </button>
          ))}
          <label className="map-toggle">
            <input type="checkbox" checked={showBacklog} onChange={(e) => setShowBacklog(e.target.checked)} />
            {t("area.backlog")}
          </label>
          <label className="map-toggle">
            <input type="checkbox" checked={showDayLines} onChange={(e) => setShowDayLines(e.target.checked)} />
            {t("map.dayLines")}
          </label>
        </div>
        {GOOGLE_MAPS_BROWSER_KEY ? <GoogleMapSurface {...surfaceProps} /> : <FakeMapSurface {...surfaceProps} />}
        {failed && <p role="alert" className="map-error">{t("map.placesFailed")}</p>}
        <div className="map-legend">
          <span>
            <span className="map-pin-dot" aria-hidden="true">
              1
            </span>
            {t("map.legendOrder")}
          </span>
          <span>
            <span className="map-pin-dot backlog" aria-hidden="true" />
            {t("map.legendBacklog")}
          </span>
          <small>{t("map.legendLine")}</small>
        </div>
      </div>
    </div>
  );
}
