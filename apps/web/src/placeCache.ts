import type { Place } from "@travel-planner/shared";
import { useEffect, useState } from "react";
import { getPlaces } from "./api";

// Places by id, kept for the session so a panel reopened on the same Event shows the name at once.
const known = new Map<string, Place>();

export const rememberPlaces = (places: Place[]) => places.forEach((p) => known.set(p.id, p));

// The place for an id, or undefined while it loads (or when the provider no longer knows it).
export function usePlace(id: string): Place | undefined {
  const [place, setPlace] = useState<Place | undefined>(() => known.get(id));
  useEffect(() => {
    if (!id) {
      setPlace(undefined);
      return;
    }
    const cached = known.get(id);
    setPlace(cached);
    if (cached) return;
    let cancelled = false;
    getPlaces([id])
      .then((found) => {
        rememberPlaces(found);
        if (!cancelled) setPlace(found[0]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);
  return place;
}
