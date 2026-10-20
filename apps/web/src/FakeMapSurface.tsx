import { useEffect, useRef, useState } from "react";
import { lineColor, Pin, type SurfaceProps } from "./mapPins";
import { useT } from "./preferences";

const PADDING = 72;

// A stand-in for Google Maps while no browser key is set (development and tests): the places are
// spread over a plain canvas by their coordinates. It does not pan or zoom.
export function FakeMapSurface({ markers, lines, selectedEventId, onSelect, rightInset }: SurfaceProps) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const points = [...markers.map((m) => m.place), ...lines.flatMap((l) => [l.from, l.to])];
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // Longitude degrees are shorter away from the equator.
  const stretch = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * stretch, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  // The part of the canvas the Event panel does not cover.
  const visibleWidth = Math.max(size.width - rightInset, PADDING * 2 + 1);
  const scale = Math.min((visibleWidth - 2 * PADDING) / spanX, (size.height - 2 * PADDING) / spanY);
  const project = (p: { lat: number; lng: number }) => ({
    x: visibleWidth / 2 + (p.lng - (minLng + maxLng) / 2) * stretch * scale,
    y: size.height / 2 + ((minLat + maxLat) / 2 - p.lat) * scale,
  });

  return (
    <div ref={box} className="fake-map" data-testid="fake-map">
      <svg width={size.width} height={size.height} aria-hidden="true">
        {lines.map(({ line, from, to }) => {
          const a = project(from);
          const b = project(to);
          return (
            <line
              key={`${line.from.key}>${line.to.key}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={lineColor(line)}
              strokeWidth={line.kind === "transport" ? 1.5 : 3}
              strokeDasharray={line.kind === "order" ? "8 6" : undefined}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      {markers.map((placed) => {
        const { x, y } = project(placed.place);
        const selected = placed.marker.event.id === selectedEventId;
        return (
          <button
            key={placed.marker.key}
            type="button"
            className="map-pin-button"
            style={{ left: x, top: y, zIndex: selected ? 2 : 1 }}
            aria-label={placed.label}
            aria-pressed={selected}
            onClick={() => onSelect(placed.marker.event.id)}
          >
            <Pin placed={placed} selected={selected} />
          </button>
        );
      })}
      <p className="fake-map-note">{t("map.fake")}</p>
    </div>
  );
}
