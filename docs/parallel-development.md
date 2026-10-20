# Working on several steps in parallel

Steps from [`implementation-plan.md`](./implementation-plan.md) can run side by side in git worktrees, one Claude Code session each. This page says how to set that up and what to watch for.

## One-time setup

1. From the main checkout, start the database once: `npm run db:up`. It listens on `localhost:5432` and is shared by every worktree.
2. Make sure the main checkout has a `.env` (copy `.env.example`). Worktrees link to it.

## Starting a step in a new worktree

1. Create the worktree, for example `claude --worktree <name>` (they live in `.claude/worktrees/<name>`, which is gitignored).
2. In the worktree, run `scripts/wt-setup.sh` once. It links the main checkout's `.env` and runs `npm install`. It does nothing in the main checkout.
3. Describe the step to Claude Code. When the step is done, Claude starts the app in the background and ends its last message with the URL and what to click.
4. Open the URL, check the behavior, and tell Claude the result. Claude stops the server and commits.

## Running the app: `npm run dev`

`npm run dev` runs `scripts/dev.mjs`. It looks for the first free port from 3001 for the API and from 5173 for the web app, starts both, and prints:

```
Travel Planner: http://localhost:5174  (API on 3002)
```

So any number of checkouts can run `npm run dev` at the same time without settings. The web app's proxy reads `API_PORT`, which the script sets. The ports can change from run to run; always use the URL that was printed. Ctrl+C stops both servers.

`npm run dev:api` and `npm run dev:web` still start one half each, on the old fixed ports (3001 and Vite's 5173). Use them only if you need that.

## Steps that change the database schema

All worktrees share one Postgres database, so a migration run in one worktree is visible to all the others. To keep them from stepping on each other:

- A step that adds a Drizzle migration is marked **Schema: yes** in the plan. Run it alone and merge it first.
- Other worktrees then rebase on `main` and run the migration before they continue.
- Mark a step "Schema: yes" as soon as it turns out to need a migration, even if it was not marked before.
- If you must check another worktree while a schema step is in progress, create a separate database for it (`createdb` through the container, then point that worktree's `.env` at it; replace the symlink with a real file) and drop it afterwards.
- Two steps that both add migrations at the same time would pick the same number (`0015_*`). Do not run them in parallel.

## Reference

| What | Where |
| --- | --- |
| Free-port launcher | `scripts/dev.mjs` |
| New worktree setup | `scripts/wt-setup.sh` |
| Rules Claude follows (end-of-step check, worktrees) | `CLAUDE.md` |
| Which steps change the schema | **Schema: yes** in `docs/implementation-plan.md` |
