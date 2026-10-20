import { z } from "zod";

// How requests say who is asking (the access token, or the guest id), and what to do when the API
// says the session has ended. Set once by the AuthProvider.
type AuthHooks = {
  // Waits for the session to be known. Throws SessionEndedError when the session has ended.
  headers: () => Promise<Record<string, string>>;
  onSessionEnded: () => void;
};

let hooks: AuthHooks | undefined;

export const authHooks = () => hooks;

export function configureApi(next: AuthHooks | undefined) {
  hooks = next;
}


// After login: adds the guest session's Trips to the account. The page has not finished starting,
// so this sends its own credentials instead of asking the hooks.
export async function mergeGuest(token: string, guestId: string): Promise<number> {
  const res = await fetch("/api/me/merge-guest", { method: "POST", headers: { authorization: `Bearer ${token}`, "x-guest-id": guestId } });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return z.object({ merged: z.number() }).parse(await res.json()).merged;
}
