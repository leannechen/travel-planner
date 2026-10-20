// The guest session: a random id this browser keeps and sends with its requests, so a visitor's
// Trips are theirs without logging in. On login the Trips move to the account and the id goes.
const KEY = "travel-planner.guest-id";

let inMemory: string | undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The id if this browser has one; does not make one.
export function peekGuestId(): string | undefined {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && UUID.test(saved)) return saved;
  } catch {
    // Without storage the id lasts until the page is closed.
  }
  return inMemory;
}

export function guestId(): string {
  const existing = peekGuestId();
  if (existing) return existing;
  const id = crypto.randomUUID();
  inMemory = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Kept in memory only.
  }
  return id;
}

export function forgetGuestId() {
  inMemory = undefined;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to remove.
  }
}
