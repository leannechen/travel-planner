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
