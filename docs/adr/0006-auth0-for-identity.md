# Identity is delegated to Auth0

Sign-in (email and Google) is handled by Auth0: the React app uses the Auth0 SDK and the API validates the access token it receives. Our database keeps its own `User` record keyed by the Auth0 subject identifier, holding ownership, language and Editor membership. We delegate identity because authentication carries high security risk and low product differentiation; this is the one place where the backend is not self-built (ADR 0004).

## Considered Options

- **Better Auth in our own API**: credentials in our own database and full control, but we would own the security surface of password and session handling.
