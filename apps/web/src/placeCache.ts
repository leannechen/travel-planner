import { MAX_PLACE_IDS, type Place } from "@travel-planner/shared";
import { useEffect, useState } from "react";
import { getPlaces } from "./api";

// Places by id, kept for the session so a panel reopened on the same Event shows the name at once.
const known = new Map<string, Place>();

export const rememberPlaces = (places: Place[]) => places.forEach((p) => known.set(p.id, p));

export type PlaceLookup = { status: "none" | "loading" | "found" | "missing" | "error"; place?: Place };

// The place for an id. "missing" means the provider no longer knows it, "error" that the lookup failed.
export function usePlace(id: string): PlaceLookup {
  const [lookup, setLookup] = useState<PlaceLookup>(() => initial(id));
  useEffect(() => {
    setLookup(initial(id));
    if (!id || known.has(id)) return;
    let cancelled = false;
    getPlaces([id])
      .then((found) => {
        rememberPlaces(found);
        if (!cancelled) setLookup(found[0] ? { status: "found", place: found[0] } : { status: "missing" });
      })
      .catch(() => {
        if (!cancelled) setLookup({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return lookup;
}

// Several places at once (the Map View). Ids the provider does not know are left out; `failed` is
// true when a lookup did not come through, so the map can say some places are missing.
export function usePlaces(ids: string[]): { places: Map<string, Place>; loading: boolean; failed: boolean } {
  const key = [...new Set(ids)].sort().join("\n");
  const [, bump] = useState(0);
  const [state, setState] = useState({ key: "", failed: false });
  useEffect(() => {
    const wanted = key ? key.split("\n") : [];
    const missing = wanted.filter((id) => !known.has(id));
    if (missing.length === 0) {
      setState({ key, failed: false });
      return;
    }
    let cancelled = false;
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += MAX_PLACE_IDS) chunks.push(missing.slice(i, i + MAX_PLACE_IDS));
    Promise.allSettled(chunks.map((chunk) => getPlaces(chunk).then(rememberPlaces))).then((results) => {
      if (cancelled) return;
      setState({ key, failed: results.some((r) => r.status === "rejected") });
      bump((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  const places = new Map<string, Place>();
  for (const id of ids) {
    const place = known.get(id);
    if (place) places.set(id, place);
  }
  return { places, loading: state.key !== key, failed: state.failed && state.key === key };
}

function initial(id: string): PlaceLookup {
  if (!id) return { status: "none" };
  const place = known.get(id);
  return place ? { status: "found", place } : { status: "loading" };
}
