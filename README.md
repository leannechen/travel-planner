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

Other commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

Layout: `apps/web` (React + Vite), `apps/api` (Express), `packages/shared` (Zod schemas shared by both).
