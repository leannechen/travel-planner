import type { AuthClient } from "./authClient";
import { createAuth0Auth } from "./auth0Auth";
import { createFakeAuth } from "./fakeAuth";

// The real Auth0 client when the tenant is configured (VITE_AUTH0_*), else the fake, so local
// development needs no tenant. A production build without a tenant has no way to log in.
export function authFromEnv(): AuthClient {
  const { VITE_AUTH0_DOMAIN: domain, VITE_AUTH0_CLIENT_ID: clientId, VITE_AUTH0_AUDIENCE: audience } = import.meta.env;
  if (domain && clientId && audience) return createAuth0Auth({ domain, clientId, audience });
  if (import.meta.env.PROD) throw new Error("VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID and VITE_AUTH0_AUDIENCE are required");
  const fake = createFakeAuth();
  (window as unknown as { __fakeAuth: unknown }).__fakeAuth = fake;
  return fake;
}
