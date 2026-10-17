// Pure rules for the order of Days in a Trip. Lists hold Day ids in position
// order; position N is index N - 1.

// `position` is 1-based and may be one past the end (append).
export function insertAt<T>(ids: readonly T[], id: T, position: number): T[] {
  if (!Number.isInteger(position) || position < 1 || position > ids.length + 1) {
    throw new RangeError(`Position ${position} is outside 1..${ids.length + 1}`);
  }
  return [...ids.slice(0, position - 1), id, ...ids.slice(position - 1)];
}

export function removeId<T>(ids: readonly T[], id: T): T[] {
  return ids.filter((x) => x !== id);
}

// Moves one step earlier (-1) or later (1); a no-op at either end or for an unknown id.
export function moveBy<T>(ids: readonly T[], id: T, delta: -1 | 1): T[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

// True when `proposed` holds exactly the ids of `current`, each once.
export function isReorderOf<T>(current: readonly T[], proposed: readonly T[]): boolean {
  return proposed.length === current.length && new Set(proposed).size === current.length && proposed.every((id) => current.includes(id));
}
