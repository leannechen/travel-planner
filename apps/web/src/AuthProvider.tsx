import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { configureApi, mergeGuest } from "./apiAuth";
import { loggedOutUrl, PopupBlockedError, PopupClosedError, SessionEndedError, type AuthClient } from "./authClient";
import { forgetGuestId, guestId, peekGuestId } from "./guest";
import { keepNotice } from "./pendingEdits";
import { usePreferences } from "./preferences";

// "loading": Auth0 has not said yet whether there is a session. "guest": no session; the browser's
// anonymous guest session is used. "expired": there was a session and it ended; the Trip stays on
// screen, read-only, until the user logs in again.
export type AuthStatus = "loading" | "guest" | "user" | "expired";

// Set when this load is the return from the login page.
export type Arrival = { merged: number };

export type Auth = {
  status: AuthStatus;
  email?: string;
  arrival?: Arrival;
  // Auth0 sent the user back with an error. Going back from its page is not one.
  loginError: boolean;
  dismissLoginError: () => void;
  // Full-page login from the current address (or `returnTo`).
  login: (returnTo?: string) => Promise<void>;
  // Login in a popup, for an expired session; call it straight from a click.
  // "other": a different account logged in, so the page was reloaded.
  loginInPlace: () => Promise<"same" | "blocked" | "closed" | "other">;
  logout: () => Promise<void>;
};

const AuthContext = createContext<Auth | undefined>(undefined);

export function AuthProvider({ client, children }: { client: AuthClient; children: ReactNode }) {
  const { language } = usePreferences();
  const languageRef = useRef(language);
  languageRef.current = language;

  const [status, setStatusState] = useState<AuthStatus>("loading");
  const [email, setEmail] = useState<string | undefined>();
  const [arrival, setArrival] = useState<Arrival | undefined>();
  const [loginError, setLoginError] = useState(false);
  // The same values, readable from requests that finish later.
  const statusRef = useRef<AuthStatus>("loading");
  const subRef = useRef<string | undefined>(undefined);
  const setStatus = useCallback((next: AuthStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  // Resolves when the session is known and the guest's Trips (if any) are on the account, so no
  // request is sent before then.
  const ready = useRef<Promise<void> | undefined>(undefined);
  const start = () =>
    (ready.current ??= (async () => {
      const result = await client.start();
      if (result.error) setLoginError(true);
      if (!result.user) {
        setStatus("guest");
        return;
      }
      subRef.current = result.user.sub;
      setEmail(result.user.email);
      let merged = 0;
      // Also tried on a later load if it failed once, as long as the browser still has the guest id.
      const guest = peekGuestId();
      if (guest) {
        try {
          merged = await mergeGuest(await client.getToken(), guest);
          forgetGuestId();
        } catch {
          // Keep the guest id; the next load tries again. The Trips stay where they are meanwhile.
        }
      }
      if (result.returned) setArrival({ merged });
      setStatus("user");
    })());

  // Layout effect: it runs before the page's own effects, which already ask for the Trips.
  useLayoutEffect(() => {
    void start();
    configureApi({
      async headers(): Promise<Record<string, string>> {
        await start();
        if (statusRef.current === "expired") throw new SessionEndedError();
        if (statusRef.current === "user") {
          try {
            const token = await client.getToken();
            // Another tab can log in as someone else; the Trips on screen are still the first one's.
            const sub = await client.currentSub();
            if (subRef.current && sub !== subRef.current) throw new SessionEndedError();
            return { authorization: `Bearer ${token}` };
          } catch (err) {
            if (err instanceof SessionEndedError) setStatus("expired");
            throw err;
          }
        }
        return { "x-guest-id": guestId() };
      },
      onSessionEnded: () => {
        if (statusRef.current === "user") setStatus("expired");
      },
    });
    return () => configureApi(undefined);
  }, [client]);

  const login = useCallback(
    (returnTo?: string) => client.loginRedirect({ language: languageRef.current, returnTo }),
    [client],
  );

  const loginInPlace = useCallback(async () => {
    try {
      const user = await client.loginPopup({ language: languageRef.current });
      if (subRef.current && user.sub !== subRef.current) {
        // Someone else's Trips would be on screen under this one's edits; the page says so after it reloads.
        keepNotice();
        window.location.reload();
        return "other" as const;
      }
      subRef.current = user.sub;
      setEmail(user.email);
      setStatus("user");
      return "same" as const;
    } catch (err) {
      if (err instanceof PopupBlockedError) return "blocked" as const;
      if (err instanceof PopupClosedError) return "closed" as const;
      // Auth0 refused in the popup (or sent nothing back): the same strip as after a failed redirect.
      setLoginError(true);
      return "closed" as const;
    }
  }, [client, setStatus]);

  const logout = useCallback(() => client.logout(loggedOutUrl()), [client]);
  const dismissLoginError = useCallback(() => setLoginError(false), []);

  const value = useMemo<Auth>(
    () => ({ status, email, arrival, loginError, dismissLoginError, login, loginInPlace, logout }),
    [status, email, arrival, loginError, dismissLoginError, login, loginInPlace, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth needs an AuthProvider");
  return value;
}
