# Travel Planner

Product rules: docs/PRD.md. Vocabulary: CONTEXT.md. Build order and status: docs/implementation-plan.md.

After committing each implementation step, run the code-reviewer subagent on that commit. Fix confirmed problems in a follow-up commit and report the rest.

Before every commit, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`; commit only when all pass.

At the end of each step, tell the user how to check the new behavior in the browser (what to start, what to click, what they should see).
