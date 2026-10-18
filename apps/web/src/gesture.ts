// The click that ends a drag or a resize must not select an Event or create one: dragging never
// opens the edit panel. A gesture marks its end, and click handlers ask whether one just ended.
let endedAt = Number.NEGATIVE_INFINITY;

export const endGesture = () => {
  endedAt = performance.now();
};

export const gestureJustEnded = () => performance.now() - endedAt < 50;
