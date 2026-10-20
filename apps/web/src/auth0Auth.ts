import {
  AuthenticationError,
  createAuth0Client,
  PopupCancelledError,
  PopupOpenError,
  PopupTimeoutError,
  type Auth0Client,
  type GetTokenSilentlyOptions,
  type User,
} from "@auth0/auth0-spa-js";
import { once, PopupBlockedError, PopupClosedError, SessionEndedError, uiLocale, type AuthClient, type AuthUser, type LoginOptions } from "./authClient";

export type Auth0Settings = { domain: string; clientId: string; audience: string };

type AppState = { returnTo?: string };

const toUser = (user: User | undefined): AuthUser | undefined =>
  user?.sub ? { sub: user.sub, email: user.email ?? "" } : undefined;

// The refresh token is missing, expired or refused: the user has to log in again.
const SESSION_ERRORS = new Set(["missing_refresh_token", "invalid_grant", "login_required", "consent_required", "interaction_required"]);

// The Auth0 SPA SDK with rotating refresh tokens (ADR 0006). Safari blocks the cookie that silent
// login in a hidden frame needs, so the session is kept with a refresh token in local storage and
// the frame fallback is off. The tenant must have refresh token rotation on.
export function createAuth0Auth({ domain, clientId, audience }: Auth0Settings): AuthClient {
  const client = once<Auth0Client>(() =>
    createAuth0Client({
      domain,
      clientId,
      useRefreshTokens: true,
      useRefreshTokensFallback: false,
      cacheLocation: "localstorage",
      authorizationParams: {
        audience,
        redirect_uri: window.location.origin,
        scope: "openid profile email offline_access",
      },
    }),
  );

  const params = (o: LoginOptions) => ({
    ui_locales: uiLocale(o.language),
    ...(o.loginHint ? { login_hint: o.loginHint } : {}),
    ...(o.screenHint ? { screen_hint: o.screenHint } : {}),
  });

  return {
    start: once(async () => {
      const auth0 = await client();
      const query = new URLSearchParams(window.location.search);
      // Auth0 sends the browser back with `code` (success) or `error` (it could not log in), and `state`.
      const returned = query.has("state") && (query.has("code") || query.has("error"));
      let error = false;
      if (returned) {
        let returnTo: string | undefined;
        try {
          const result = await auth0.handleRedirectCallback<AppState>();
          returnTo = result.appState?.returnTo;
        } catch (err) {
          error = true;
          if (err instanceof AuthenticationError) returnTo = (err.appState as AppState | undefined)?.returnTo;
        }
        window.history.replaceState(null, "", returnTo ?? "/");
      }
      return { user: toUser(await auth0.getUser()), returned, error };
    }),
    async loginRedirect(options) {
      const auth0 = await client();
      await auth0.loginWithRedirect({
        appState: { returnTo: options.returnTo ?? `${window.location.pathname}${window.location.search}` } satisfies AppState,
        authorizationParams: params(options),
      });
    },
    async loginPopup(options) {
      const auth0 = await client();
      try {
        await auth0.loginWithPopup({ authorizationParams: params(options) });
      } catch (err) {
        if (err instanceof PopupOpenError) throw new PopupBlockedError();
        if (err instanceof PopupCancelledError || err instanceof PopupTimeoutError) throw new PopupClosedError();
        throw err;
      }
      const user = toUser(await auth0.getUser());
      if (!user) throw new SessionEndedError();
      return user;
    },
    async logout(returnTo) {
      const auth0 = await client();
      // returnTo must be in the application's Allowed Logout URLs.
      await auth0.logout({ logoutParams: { returnTo } });
    },
    async getToken() {
      const auth0 = await client();
      try {
        const token = await auth0.getTokenSilently({ authorizationParams: { audience } } satisfies GetTokenSilentlyOptions);
        if (!token) throw new SessionEndedError();
        return token;
      } catch (err) {
        const code = (err as { error?: string }).error;
        if (code && SESSION_ERRORS.has(code)) throw new SessionEndedError();
        throw err;
      }
    },
  };
}
