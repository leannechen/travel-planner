// Pure rules for changing an Event's time by dragging on the axis. Only the dragged Event changes
// (ADR 0001). Times are minutes from 00:00; `bounds` is the axis range being shown.

import { MAX_DURATION_MINUTES } from "./index";
import { SNAP_MINUTES } from "./time-layout";

export const MIN_DURATION_MINUTES = 15;

type Times = { startMinute: number; durationMinutes: number };
type Bounds = { startMinute: number; endMinute: number };

// A vertical distance in pixels as minutes, rounded to the nearest snap step.
export function pxToMinutes(px: number, pxPerHour: number, snap: number = SNAP_MINUTES): number {
  const steps = Math.round(((px / pxPerHour) * 60) / snap);
  return steps === 0 ? 0 : steps * snap;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

// The nearest time on the grid; an Event that starts off the grid (typed in the panel) lands on it
// as soon as it is dragged.
export const snapToGrid = (minute: number, snap: number = SNAP_MINUTES) => Math.round(minute / snap) * snap;

// Move by `delta` minutes, keeping the Event inside the axis. An Event that already runs past
// the bottom of the axis is never pushed by a drag that does not move it.
export function moveEvent(event: Times, delta: number, bounds: Bounds): Times {
  if (delta === 0) return event;
  const low = Math.min(bounds.startMinute, event.startMinute);
  const high = Math.max(bounds.endMinute - event.durationMinutes, event.startMinute);
  return {
    startMinute: clamp(snapToGrid(event.startMinute + delta), low, high),
    durationMinutes: event.durationMinutes,
  };
}

// Move the bottom edge: the start stays, the duration changes.
export function resizeBottom(event: Times, delta: number, bounds: Bounds): Times {
  if (delta === 0) return event;
  const end = event.startMinute + event.durationMinutes;
  const newEnd = clamp(snapToGrid(end + delta), event.startMinute + MIN_DURATION_MINUTES, Math.min(Math.max(bounds.endMinute, end), event.startMinute + MAX_DURATION_MINUTES));
  return { startMinute: event.startMinute, durationMinutes: newEnd - event.startMinute };
}

// Move the top edge: the end stays, the start and the duration change.
export function resizeTop(event: Times, delta: number, bounds: Bounds): Times {
  if (delta === 0) return event;
  const end = event.startMinute + event.durationMinutes;
  const newStart = clamp(
    snapToGrid(event.startMinute + delta),
    Math.max(Math.min(bounds.startMinute, event.startMinute), end - MAX_DURATION_MINUTES),
    end - MIN_DURATION_MINUTES,
  );
  return { startMinute: newStart, durationMinutes: end - newStart };
}
