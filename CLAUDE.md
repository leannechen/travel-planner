# Travel Planner

Product rules: docs/PRD.md. Vocabulary: CONTEXT.md. Build order and status: docs/implementation-plan.md.

After committing each implementation step, run the code-reviewer subagent on that commit. Fix confirmed problems in a follow-up commit and report the rest.

Before every commit, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`; commit only when all pass.

At the end of each step, start the app yourself with `npm run dev` in the background (it picks free ports, so several worktrees can run at once) and read the URL it prints. Then tell the user how to check the new behavior: the clickable URL, what to click, what they should see. Put this at the very end of the last message. Stop the server once the user has verified.

Worktrees (details in docs/parallel-development.md): run `scripts/wt-setup.sh` once in a new worktree (links the shared `.env`, installs dependencies). The database is shared by all worktrees: start it once from the main checkout with `npm run db:up`. A step that adds a migration is marked "Schema: yes" in docs/implementation-plan.md; do not run it in parallel with other work, and merge it before other worktrees continue.
