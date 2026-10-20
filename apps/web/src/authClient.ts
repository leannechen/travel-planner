import type { Language } from "./i18n";

// Who is logged in, as the page shows them.
export type AuthUser = { email: string; sub: string };

export type LoginOptions = {
  // Sent to the hosted login page as `ui_locales`, so it follows the interface language.
  language: Language;
  // Where the page comes back to after a full-page login. The current address when left out.
  returnTo?: string;
  // Step 20: the invited address, and opening the sign-up screen.
  loginHint?: string;
  screenHint?: "signup";
};

export type StartResult = {
  user?: AuthUser;
  // This load is the return from the login page.
  returned: boolean;
  // Auth0 sent the user back with an error (never for a user who just went back from its page).
  error: boolean;
};

// The session ended: the refresh token is gone or was refused, or the API refused the access token.
export class SessionEndedError extends Error {
  constructor() {
    super("Your session expired. Log in to keep editing.");
    this.name = "SessionEndedError";
  }
}

// The browser did not open the login popup.
export class PopupBlockedError extends Error {
  constructor() {
    super("The login popup was blocked");
    this.name = "PopupBlockedError";
  }
}

// The popup was closed, or timed out, before login finished.
export class PopupClosedError extends Error {
  constructor() {
    super("The login popup was closed");
    this.name = "PopupClosedError";
  }
}

// Sign-in as the page needs it (ADR 0006). The Auth0 SDK is behind this, and a fake stands in for it
// in tests and in development without a tenant.
export interface AuthClient {
  // Finishes a return from the login page if this load is one, then says who is logged in.
  // Called once; the answer is the same on later calls.
  start(): Promise<StartResult>;
  // Full-page login (every entry point). Leaves the page.
  loginRedirect(options: LoginOptions): Promise<void>;
  // Login in a popup, so the page and its unsaved edits stay. Call it straight from a click.
  loginPopup(options: LoginOptions): Promise<AuthUser>;
  // Ends the session and returns to `returnTo`. Leaves the page.
  logout(returnTo: string): Promise<void>;
  // An access token for the API. Throws SessionEndedError when there is no session any more.
  getToken(): Promise<string>;
}

// Auth0's name for the interface language (Traditional Chinese must be enabled in the tenant).
export const uiLocale = (language: Language) => (language === "zh" ? "zh-TW" : "en");

export function once<T>(make: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => (promise ??= make());
}

// Where Auth0 sends the browser after logout, and where the page shows the Landing page.
export const LOGGED_OUT_PARAM = "loggedout";
export const loggedOutUrl = () => `${window.location.origin}/?${LOGGED_OUT_PARAM}=1`;
