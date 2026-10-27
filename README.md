# Travel Planner

A web app for planning trips on a time axis. Product rules: [`docs/PRD.md`](docs/PRD.md). Vocabulary: [`CONTEXT.md`](CONTEXT.md). Build order and status: [`docs/implementation-plan.md`](docs/implementation-plan.md).

## Development

Requires Node.js 22 or later and Docker.

```sh
npm install
cp .env.example .env
npm run db:up      # PostgreSQL on localhost:5432
npm run dev        # API on :3001, web on :5173
```

The API applies database migrations on start. After changing `apps/api/src/db/schema.ts`, run `npm run db:generate -w @travel-planner/api` and commit the new files in `apps/api/drizzle/`. Tests use a separate `travel_planner_test` database, created automatically.

To run a second checkout (a git worktree) beside one that already uses :3001 and :5173, give its API another port and tell its web server where to find it. A new worktree has no `.env` (it is not tracked), so copy the first checkout's `.env` into it first. Both checkouts then use the same database, so only do this when the branches have the same migrations:

```sh
PORT=3002 API_PORT=3002 npm run dev   # API on :3002, web on the next free port, usually :5174
```

Other commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

Layout: `apps/web` (React + Vite), `apps/api` (Express), `packages/shared` (Zod schemas shared by both).
