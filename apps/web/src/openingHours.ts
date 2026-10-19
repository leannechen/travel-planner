import { hasOpeningConflict, MAX_PLACE_IDS, showsOpeningHours, weekdayOf, type Event, type OpeningHours } from "@travel-planner/shared";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getOpeningHours } from "./api";

// Opening hours by place id, kept for the session. The server keeps them in its place cache and
// fetches stale ones again; the page asks for the hours of the Events that have them on whenever a
// Trip or a panel is shown, and does not keep a place's hours once the server has none.
const known = new Map<string, OpeningHours>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function rememberOpeningHours(placeId: string, hours: OpeningHours) {
  known.set(placeId, hours);
  changed();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

async function fetchAll(ids: string[]) {
  const found = new Map<string, OpeningHours>();
  for (let i = 0; i < ids.length; i += MAX_PLACE_IDS) {
    for (const [id, hours] of await getOpeningHours(ids.slice(i, i + MAX_PLACE_IDS))) found.set(id, hours);
  }
  return found;
}

export type OpeningHoursLookup = {
  hours: ReadonlyMap<string, OpeningHours>;
  // The first answer for these places has not arrived yet.
  loading: boolean;
};

// The opening hours of these places. A place the server has no hours for, or that could not be
// fetched, is left out: the caller shows nothing for it.
export function useOpeningHours(placeIds: string[]): OpeningHoursLookup {
  useSyncExternalStore(subscribe, () => version);
  const key = [...new Set(placeIds)].sort().join(",");
  const [loading, setLoading] = useState(key !== "");
  useEffect(() => {
    if (!key) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const wanted = key.split(",");
    fetchAll(wanted)
      .then((found) => {
        if (cancelled) return;
        for (const id of wanted) {
          const hours = found.get(id);
          if (hours) known.set(id, hours);
          else known.delete(id);
        }
        changed();
      })
      // A failed request shows nothing new; the next visit asks again.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return { hours: known, loading };
}

// The places whose hours a set of Events needs.
export const hoursPlaceIds = (events: Event[]) =>
  events.flatMap((e) => (e.openingHoursOn && showsOpeningHours(e.kind) && e.placeId ? [e.placeId] : []));

// Whether the Event's time does not fit the opening hours of its place on its Day (PRD §3.5). False
// for anything that cannot be checked: hours off or unknown, not on a Day, or a Trip without a date.
export function eventConflicts(
  event: Event,
  dayPosition: number | undefined,
  startDate: string | undefined,
  hours: ReadonlyMap<string, OpeningHours>,
): boolean {
  if (!event.openingHoursOn || !showsOpeningHours(event.kind) || !event.placeId || !event.dayId) return false;
  const placeHours = hours.get(event.placeId);
  if (!placeHours || dayPosition === undefined || !startDate) return false;
  return hasOpeningConflict({ hours: placeHours, weekday: weekdayOf(startDate, dayPosition), startMinute: event.startMinute, durationMinutes: event.durationMinutes });
}
