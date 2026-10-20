import { once, SessionEndedError, PopupBlockedError, type AuthClient, type AuthUser } from "./authClient";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const SESSION_KEY = "travel-planner.fake-auth";
const RETURNED_KEY = "travel-planner.fake-auth-returned";
const FAIL_KEY = "travel-planner.fake-auth-fail";

type Session = { email: string; expired?: boolean };

export type FakeAuth = AuthClient & {
  // Development helpers (window.__fakeAuth): end the session as if the refresh token ran out, make
  // the next full-page login come back with an error, or refuse to open the popup.
  expire(): void;
  failNextLogin(): void;
  blockPopups: boolean;
};

// Auth0 stand-in for tests and for development without a tenant: logging in is instant and uses
// `options.email`. Its token "fake:<email>" is only accepted by the API's fake verifier.
export function createFakeAuth({
  store = localStorage,
  email = "lena@example.com",
  navigate = (url: string) => window.location.assign(url),
}: { store?: Store; email?: string; navigate?: (url: string) => void } = {}): FakeAuth {
  const read = (): Session | undefined => {
    try {
      return JSON.parse(store.getItem(SESSION_KEY) ?? "null") ?? undefined;
    } catch {
      return undefined;
    }
  };
  const write = (session: Session) => store.setItem(SESSION_KEY, JSON.stringify(session));
  const userOf = (session: Session): AuthUser => ({ email: session.email, sub: session.email });

  const fake: FakeAuth = {
    blockPopups: false,
    start: once(async () => {
      const returned = store.getItem(RETURNED_KEY) !== null;
      const error = store.getItem(RETURNED_KEY) === "error";
      store.removeItem(RETURNED_KEY);
      const session = read();
      return { user: session && userOf(session), returned, error };
    }),
    async loginRedirect({ returnTo }) {
      if (store.getItem(FAIL_KEY)) {
        store.removeItem(FAIL_KEY);
        store.setItem(RETURNED_KEY, "error");
      } else {
        write({ email });
        store.setItem(RETURNED_KEY, "ok");
      }
      navigate(returnTo ?? window.location.href);
    },
    async loginPopup() {
      if (fake.blockPopups) throw new PopupBlockedError();
      const session = { email };
      write(session);
      return userOf(session);
    },
    async logout(returnTo) {
      store.removeItem(SESSION_KEY);
      navigate(returnTo);
    },
    async getToken() {
      const session = read();
      if (!session || session.expired) throw new SessionEndedError();
      return `fake:${session.email}`;
    },
    expire() {
      const session = read();
      if (session) write({ ...session, expired: true });
    },
    failNextLogin() {
      store.setItem(FAIL_KEY, "1");
    },
  };
  return fake;
}
