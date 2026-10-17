// Pure rules for drawing a Day's Events on a time axis. Times are minutes from 00:00 of the Day.

export const MINUTES_PER_DAY = 24 * 60;

type Timed = { id: string; startMinute: number; durationMinutes: number };

export type Placement = { id: string; column: number; columnCount: number };

const endOf = (e: Timed) => e.startMinute + e.durationMinutes;

// Events that overlap are drawn side by side. Events are grouped into clusters of chained
// overlaps; inside a cluster each Event takes the first free column, and every Event in the
// cluster gets the cluster's column count, so widths are equal. Back-to-back Events do not
// overlap. The result does not depend on the input order.
export function layoutDay(items: readonly Timed[]): Placement[] {
  const sorted = [...items].sort(
    (a, b) =>
      a.startMinute - b.startMinute ||
      b.durationMinutes - a.durationMinutes ||
      a.id.localeCompare(b.id),
  );

  const result: Placement[] = [];
  let cluster: Placement[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = () => {
    for (const p of cluster) p.columnCount = columnEnds.length;
    result.push(...cluster);
    cluster = [];
    columnEnds = [];
  };

  for (const item of sorted) {
    if (item.startMinute >= clusterEnd) closeCluster();

    let column = columnEnds.findIndex((end) => end <= item.startMinute);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = endOf(item);
    clusterEnd = cluster.length === 0 ? endOf(item) : Math.max(clusterEnd, endOf(item));
    cluster.push({ id: item.id, column, columnCount: 0 });
  }
  closeCluster();

  return result;
}

export const DEFAULT_AXIS_START = 8 * 60;
export const DEFAULT_AXIS_END = 22 * 60;

// The hours shown on the axis: 08:00 to 22:00, widened to whole hours when an Event falls
// outside. The end never goes past midnight; an Event running past it is cut off there.
export function axisRange(items: readonly Timed[]): { startMinute: number; endMinute: number } {
  let start = DEFAULT_AXIS_START;
  let end = DEFAULT_AXIS_END;
  for (const item of items) {
    start = Math.min(start, Math.floor(item.startMinute / 60) * 60);
    end = Math.max(end, Math.ceil(Math.min(endOf(item), MINUTES_PER_DAY) / 60) * 60);
  }
  return { startMinute: start, endMinute: end };
}

export function formatMinute(minute: number): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// Parses "HH:MM" (as an <input type="time"> gives it) into minutes, or undefined.
export function parseTime(text: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined;
}

export const SNAP_MINUTES = 15;

// The time under a click at `offsetPx` from the top of the axis, rounded down to the snap step
// and kept inside the axis.
export function minuteAtOffset(
  offsetPx: number,
  range: { startMinute: number; endMinute: number },
  pxPerHour: number,
  snap: number = SNAP_MINUTES,
): number {
  const raw = range.startMinute + (offsetPx / pxPerHour) * 60;
  const snapped = Math.floor(raw / snap) * snap;
  const last = Math.min(range.endMinute, MINUTES_PER_DAY) - snap;
  return Math.min(Math.max(snapped, range.startMinute), last);
}
