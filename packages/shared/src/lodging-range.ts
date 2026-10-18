// A Lodging is tied to Day positions, not to Day contents (PRD §3.2). It covers the nights of
// Days `checkInPosition` to `checkInPosition + nights - 1` and checks out on the Day after.

export type Stay = { checkInPosition: number; nights: number };

// A new Day lands at position p; the Days from p on move one later.
export function lodgingAfterInsert(stay: Stay, p: number): Stay {
  if (p <= stay.checkInPosition) return { ...stay, checkInPosition: stay.checkInPosition + 1 };
  if (p <= stay.checkInPosition + stay.nights) return { ...stay, nights: stay.nights + 1 };
  return stay;
}

// The Day at position d is removed; later Days move one earlier. A stay left with no nights
// is reported as "empty".
export function lodgingAfterDelete(stay: Stay, d: number): Stay | "empty" {
  if (d < stay.checkInPosition) return { ...stay, checkInPosition: stay.checkInPosition - 1 };
  if (d < stay.checkInPosition + stay.nights) {
    return stay.nights === 1 ? "empty" : { ...stay, nights: stay.nights - 1 };
  }
  return stay;
}

// Every night must fall on a Day of the Trip. The check-out Day may be the day after the last one.
export function lodgingFits(stay: Stay, dayCount: number): boolean {
  return stay.checkInPosition >= 1 && stay.nights >= 1 && stay.checkInPosition + stay.nights - 1 <= dayCount;
}

export type LodgingBanner = { type: "night"; night: number; of: number } | { type: "check-out" };

// What the stay shows at the top of the Day at `position`, if anything.
export function lodgingBanner(stay: Stay, position: number): LodgingBanner | undefined {
  const offset = position - stay.checkInPosition;
  if (offset >= 0 && offset < stay.nights) return { type: "night", night: offset + 1, of: stay.nights };
  if (offset === stay.nights) return { type: "check-out" };
  return undefined;
}
