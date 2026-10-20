import { dayColorIndex, type MapLine, type MapMarker, type Place } from "@travel-planner/shared";
import { KindIcon } from "./kinds";

// What a map surface draws, with the place coordinates looked up and the label text translated.
export type PlacedMarker = { marker: MapMarker; place: Place; label: string };
export type PlacedLine = { line: MapLine; from: Place; to: Place };

export type SurfaceProps = {
  markers: PlacedMarker[];
  lines: PlacedLine[];
  selectedEventId?: string;
  onSelect: (eventId: string) => void;
  // Changes when the map should fit its markers again (the filter changed, or "Fit all").
  fitKey: string;
};

// The CSS variable holding a Day's color (`--d1` to `--d8` in styles.css); gray for the Backlog.
export const dayColorVar = (position: number | null) => (position === null ? "var(--muted)" : `var(--d${dayColorIndex(position) + 1})`);

// One marker: the Day's number in a circle colored by Day; a dashed gray circle for the Backlog; the
// transport icon for a departure. The selected one also shows its label. Used by both map surfaces
// (Google renders it to static markup for its marker content), so it must stay free of state.
export function Pin({ placed, selected }: { placed: PlacedMarker; selected: boolean }) {
  const { marker, label } = placed;
  const kind = marker.role === "departure" ? "departure" : marker.dayId === null ? "backlog" : "day";
  return (
    <span className={`map-pin ${kind}${selected ? " selected" : ""}`} style={{ ["--pin" as string]: dayColorVar(marker.dayPosition) }}>
      <span className="map-pin-dot">
        {kind === "departure" ? <KindIcon kind="transport" transportLabel={marker.event.transportLabel} size={13} /> : kind === "day" ? marker.order : null}
      </span>
      {selected && <span className="map-pin-label">{label}</span>}
    </span>
  );
}

// The color a line is drawn in, read from the page so it follows the theme.
export function lineColor(line: MapLine): string {
  if (line.kind === "transport") return cssColor("--text");
  return cssColor(`--d${dayColorIndex(line.from.dayPosition ?? 1) + 1}`);
}

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#16223b";
}
