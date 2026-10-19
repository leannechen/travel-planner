import type { Place } from "@travel-planner/shared";
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

function initial(id: string): PlaceLookup {
  if (!id) return { status: "none" };
  const place = known.get(id);
  return place ? { status: "found", place } : { status: "loading" };
}
