import type { Place, TravelMode } from "@travel-planner/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import { routeEstimates } from "./db/schema";

// How long travel times and distances may be used before they are asked for again. Like the place
// cache (ADR 0007) this figure is a choice, not something read from Google's terms; check them
// before release (plan step 27).
export const ROUTE_CACHE_DAYS = 30;

export type RouteEstimate = { durationMinutes: number; distanceMeters: number };

// When the traveller leaves, for the modes whose time depends on it (public transport runs on a
// timetable). `localHour` is the hour at the origin, which the cache is split by.
export type Departure = { at: Date; localHour: number };

// Where travel times come from. `undefined` means there is no route between the two places.
export type RouteProvider = {
  estimate(from: Place, to: Place, mode: TravelMode, departure?: Departure): Promise<RouteEstimate | undefined>;
};

// The provider could not be reached, timed out, or gave an answer that makes no sense.
export class RouteProviderError extends Error {}

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function distanceKm(a: Place, b: Place) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Average speeds and a fixed wait, for development and tests.
const FAKE_KM_PER_HOUR: Record<TravelMode, number> = { drive: 40, transit: 22, walk: 4.8 };
const FAKE_WAIT_MINUTES: Record<TravelMode, number> = { drive: 0, transit: 5, walk: 0 };
// Roads are longer than the straight line.
const FAKE_DETOUR = 1.3;

export function fakeRouteProvider(): RouteProvider {
  return {
    async estimate(from, to, mode) {
      const km = distanceKm(from, to) * FAKE_DETOUR;
      const minutes = (km / FAKE_KM_PER_HOUR[mode]) * 60 + FAKE_WAIT_MINUTES[mode];
      return { durationMinutes: Math.max(1, Math.round(minutes)), distanceMeters: Math.round(km * 1000) };
    },
  };
}

const GOOGLE_MODES: Record<TravelMode, string> = { drive: "DRIVE", transit: "TRANSIT", walk: "WALK" };
const REQUEST_TIMEOUT_MS = 5000;

const googleRouteSchema = z.object({
  // Seconds with an "s" suffix, for example "1165s".
  duration: z.string().regex(/^\d+(\.\d+)?s$/),
  distanceMeters: z.number().optional(),
});

// Google Routes API (computeRoutes). Only the duration and the distance are asked for.
export function googleRouteProvider(apiKey: string, fetchFn: typeof fetch = fetch): RouteProvider {
  return {
    async estimate(from, to, mode, departure) {
      const point = (p: Place) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
      let body: unknown;
      try {
        const res = await fetchFn("https://routes.googleapis.com/directions/v2:computeRoutes", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
          },
          body: JSON.stringify({
            origin: point(from),
            destination: point(to),
            travelMode: GOOGLE_MODES[mode],
            // Only transit is timetable-bound; without a time Google uses "now".
            ...(mode === "transit" && departure && { departureTime: departure.at.toISOString() }),
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) throw new RouteProviderError(`Route lookup failed (${res.status})`);
        body = await res.json();
      } catch (err) {
        if (err instanceof RouteProviderError) throw err;
        throw new RouteProviderError(`Route lookup failed (${err instanceof Error ? err.message : "unknown error"})`);
      }
      // No route (for example no public transport between the two places) comes back without routes.
      // Transit is never answered in Japan: https://developers.google.com/maps/faq#transit_directions_countries
      const first = (body as { routes?: unknown[] } | null)?.routes?.[0];
      if (first === undefined) return undefined;
      const parsed = googleRouteSchema.safeParse(first);
      if (!parsed.success) throw new RouteProviderError("Route lookup gave an answer that cannot be read");
      return {
        durationMinutes: Math.max(1, Math.round(parseFloat(parsed.data.duration) / 60)),
        distanceMeters: Math.round(parsed.data.distanceMeters ?? 0),
      };
    },
  };
}

// Google when a key is set, the fake travel times otherwise.
export function routeProviderFromEnv(env: NodeJS.ProcessEnv = process.env): RouteProvider {
  return env.GOOGLE_MAPS_API_KEY ? googleRouteProvider(env.GOOGLE_MAPS_API_KEY) : fakeRouteProvider();
}

// The estimate between two places, from the cache when it is younger than ROUTE_CACHE_DAYS.
// A pair with no route is cached too, so it is not asked again.
export async function routeBetween(
  db: Db,
  provider: RouteProvider,
  from: Place,
  to: Place,
  mode: TravelMode,
  departure?: Departure,
  now = new Date(),
): Promise<RouteEstimate | undefined> {
  // Transit is cached per hour of departure; the other modes do not depend on it.
  const departureHour = mode === "transit" && departure ? departure.localHour : -1;
  const key = and(
    eq(routeEstimates.fromPlaceId, from.id),
    eq(routeEstimates.toPlaceId, to.id),
    eq(routeEstimates.mode, mode),
    eq(routeEstimates.departureHour, departureHour),
  );
  const [row] = await db.select().from(routeEstimates).where(key);
  const oldest = now.getTime() - ROUTE_CACHE_DAYS * 24 * 60 * 60 * 1000;
  if (row && row.fetchedAt.getTime() > oldest) {
    return row.durationMinutes === null || row.distanceMeters === null
      ? undefined
      : { durationMinutes: row.durationMinutes, distanceMeters: row.distanceMeters };
  }
  const found = await provider.estimate(from, to, mode, departure);
  const values = { fromPlaceId: from.id, toPlaceId: to.id, mode, departureHour, durationMinutes: found?.durationMinutes ?? null, distanceMeters: found?.distanceMeters ?? null, fetchedAt: now };
  await db
    .insert(routeEstimates)
    .values(values)
    .onConflictDoUpdate({
      target: [routeEstimates.fromPlaceId, routeEstimates.toPlaceId, routeEstimates.mode, routeEstimates.departureHour],
      set: { durationMinutes: values.durationMinutes, distanceMeters: values.distanceMeters, fetchedAt: now },
    });
  return found;
}
