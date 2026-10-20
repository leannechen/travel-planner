import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lineColor, Pin, type SurfaceProps } from "./mapPins";
import { usePreferences, useT } from "./preferences";

// The browser key for the Maps JavaScript API. It is a different key from the server's
// GOOGLE_MAPS_API_KEY: restrict it to this site's addresses and to the Maps JavaScript API.
export const GOOGLE_MAPS_BROWSER_KEY: string | undefined = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || undefined;

// Advanced markers need a map id; Google's demo id works without a styled map of our own.
const MAP_ID: string = import.meta.env.VITE_GOOGLE_MAP_ID || "DEMO_MAP_ID";

const DASH = { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 };

// The loader takes its options once per page (later calls only log a warning), so the language of
// the first visit to the Map View stays for the page.
let configured = false;
function configure(language: string) {
  if (configured) return;
  configured = true;
  setOptions({ key: GOOGLE_MAPS_BROWSER_KEY!, v: "weekly", language: language === "zh" ? "zh-TW" : "en" });
}

type Overlays = { markers: google.maps.marker.AdvancedMarkerElement[]; lines: google.maps.Polyline[] };

export function GoogleMapSurface({ markers, lines, selectedEventId, onSelect, fitKey, rightInset }: SurfaceProps) {
  const t = useT();
  const { language } = usePreferences();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | undefined>(undefined);
  const overlays = useRef<Overlays>({ markers: [], lines: [] });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // The latest click handler, so markers drawn earlier call the current one.
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    configure(language);
    Promise.all([importLibrary("maps"), importLibrary("marker")]).then(
      ([{ Map }]) => {
        if (cancelled || !box.current) return;
        map.current = new Map(box.current, { mapId: MAP_ID, center: { lat: 35, lng: 135 }, zoom: 5, clickableIcons: false, streetViewControl: false, mapTypeControl: false, fullscreenControl: false });
        setReady(true);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Draw the markers and lines again whenever they, or the selection, change.
  useEffect(() => {
    const current = map.current;
    if (!ready || !current) return;
    for (const m of overlays.current.markers) m.map = null;
    for (const l of overlays.current.lines) l.setMap(null);
    const next: Overlays = { markers: [], lines: [] };
    for (const { line, from, to } of lines) {
      const color = lineColor(line);
      const dashed = line.kind === "order";
      next.lines.push(
        new google.maps.Polyline({
          map: current,
          path: [from, to],
          clickable: false,
          strokeColor: color,
          strokeWeight: dashed ? 3 : 1.5,
          strokeOpacity: dashed ? 0 : 1,
          icons: dashed ? [{ icon: { ...DASH, strokeColor: color }, offset: "0", repeat: "14px" }] : undefined,
        }),
      );
    }
    for (const placed of markers) {
      const selected = placed.marker.event.id === selectedEventId;
      const content = document.createElement("div");
      content.innerHTML = renderToStaticMarkup(<Pin placed={placed} selected={selected} />);
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: current,
        position: placed.place,
        content,
        title: placed.label,
        gmpClickable: true,
        zIndex: selected ? 2 : 1,
      });
      marker.addEventListener("gmp-click", () => select.current(placed.marker.event.id));
      next.markers.push(marker);
    }
    overlays.current = next;
  }, [ready, markers, lines, selectedEventId]);

  // Fit the markers when the filter changes, not on every selection.
  const latest = useRef(markers);
  latest.current = markers;
  const inset = useRef(rightInset);
  inset.current = rightInset;
  useEffect(() => {
    const current = map.current;
    if (!ready || !current || latest.current.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const { place } of latest.current) bounds.extend(place);
    current.fitBounds(bounds, { top: 72, bottom: 72, left: 72, right: 72 + inset.current });
    // A single place would zoom in as far as it goes.
    google.maps.event.addListenerOnce(current, "idle", () => {
      if ((current.getZoom() ?? 0) > 16) current.setZoom(16);
    });
  }, [ready, fitKey]);

  return (
    <div className="google-map-box">
      <div ref={box} className="google-map" />
      {failed && <p role="alert" className="map-error">{t("map.loadFailed")}</p>}
    </div>
  );
}
