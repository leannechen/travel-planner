import { isHoldingArea, moveEvent, pxToMinutes, type Day, type Event, type HoldingArea } from "@travel-planner/shared";
import { PX_PER_HOUR, type Range } from "./DayTimeline";

// What a dragged card shows while it is dragged: where it would land if dropped now.
export type DropPreview = {
  eventId: string;
  // The start the drop would give, on a Day.
  startMinute?: number;
  // The position of the Day it would land on, when that is not its own Day.
  dayPosition?: number;
  // The holding area it would land in.
  area?: HoldingArea;
};

// The preview for a scheduled Event dragged `draggedPx` down, with the pointer over `target` (a
// Day id or a holding area). It uses the same move as the drop, so the card never promises a time
// the drop would not give.
export function previewDrop(event: Event, target: string | undefined, draggedPx: number, range: Range, days: Day[]): DropPreview | undefined {
  if (!target) return undefined;
  if (isHoldingArea(target)) return { eventId: event.id, area: target };
  const { startMinute } = moveEvent(event, pxToMinutes(draggedPx, PX_PER_HOUR), range);
  const other = target !== event.dayId ? days.find((d) => d.id === target) : undefined;
  return other ? { eventId: event.id, startMinute, dayPosition: other.position } : { eventId: event.id, startMinute };
}
