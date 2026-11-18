# Travel Planner

A web app for planning trips on a time axis. Product rules: [`docs/PRD.md`](docs/PRD.md). Vocabulary: [`CONTEXT.md`](CONTEXT.md). Build order and status: [`docs/implementation-plan.md`](docs/implementation-plan.md).

## Development

Requires Node.js 22 or later, Docker (for the tests) and the [Neon CLI](https://neon.com/docs/cli/quickstart) (`npm i -g neon`).

```sh
npm install
cp .env.example .env
neon checkout dev --project-id still-thunder-96349587  # Neon dev branch: writes DATABASE_URL(_UNPOOLED) into .env
npm run db:up      # PostgreSQL on localhost:5432, for the tests
npm run dev        # API on :3001, web on :5173
```

The database is on Neon (project `still-thunder-96349587`): the `production` branch serves the deployed app, and local development uses the `dev` branch. `.neon` (not tracked) pins the branch this checkout works on, and the Neon commands that write `.env` (`neon checkout`, `neon deploy`, `neon env pull`) write that branch's values, so keep it on `dev`: `neon config status` shows it. Production's connection strings belong in the deployment's secrets, never in a local `.env`. To start `dev` again from production's current data, run `neon branches reset dev --parent`. Without Neon, leave `DATABASE_URL` as in `.env.example` to use the Docker database instead.

The API applies database migrations on start. After changing `apps/api/src/db/schema.ts`, run `npm run db:generate -w @travel-planner/api` and commit the new files in `apps/api/drizzle/`. Tests use a separate `travel_planner_test` database, created automatically.

To run a second checkout (a git worktree) beside one that already uses :3001 and :5173, give its API another port and tell its web server where to find it. A new worktree has no `.env` (it is not tracked), so copy the first checkout's `.env` into it first. Both checkouts then use the same database, so only do this when the branches have the same migrations:

```sh
PORT=3002 API_PORT=3002 npm run dev   # API on :3002, web on the next free port, usually :5174
```

Other commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

Layout: `apps/web` (React + Vite), `apps/api` (Express), `packages/shared` (Zod schemas shared by both).

## Deployment

Production runs on fly.io as the app `ideal-travel-planner` (`fly.toml`), built from the `Dockerfile`: one Node server that answers `/api`, the live socket and the built web app on one origin.

Every push to `main` deploys once the CI checks pass (the `deploy` job in `.github/workflows/ci.yml`). It needs the GitHub environment `production` (Settings > Environments), with its deployment branches set to `main` only, so no other branch's workflow can read its two secrets: `FLY_API_TOKEN` (from `fly tokens create deploy -a ideal-travel-planner`) and `GOOGLE_MAPS_BROWSER_KEY` (the Maps browser key, restricted to the site's address; the deploy stops without it). Set them with `gh secret set <name> --env production`. To deploy by hand instead:

```sh
fly deploy --ha=false --build-arg VITE_GOOGLE_MAPS_API_KEY=…   # without the key, the Map View shows the sample map
```

`--ha=false` keeps it to one Machine: the live collaboration rooms are held in the API's memory, and the API runs the migrations when it starts. The Machine is suspended when idle and wakes on the next request.

- **Build arguments** (`[build.args]` in `fly.toml`): the `VITE_` values, which end up in the page and are public. The build stops without the three Auth0 ones.
- **Secrets** (`fly secrets set` or `fly secrets import`): `DATABASE_URL` (Neon `production`, pooled), `DATABASE_URL_UNPOOLED` (direct, for migrations), `AUTH0_M2M_CLIENT_ID`, `AUTH0_M2M_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `OPENAI_API_KEY`.
- **Plain settings** (`[env]` in `fly.toml`): `APP_ORIGIN`, `TRUST_PROXY`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`.
- `NODE_ENV=production` is set in the image itself. Never set `AUTH_FAKE` on a deployment: the API refuses to start with it.

To try the image locally: `docker build -t travel-planner --build-arg VITE_AUTH0_DOMAIN=… --build-arg VITE_AUTH0_CLIENT_ID=… --build-arg VITE_AUTH0_AUDIENCE=… .`, then run it with the same variables as the deployment and `-p 8080:8080`.
