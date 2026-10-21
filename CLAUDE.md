# Travel Planner

Product rules: docs/PRD.md. Vocabulary: CONTEXT.md. Build order and status: docs/implementation-plan.md.

When each implementation step is completed,
1. Run the code-reviewer subagent on the uncommitted changes. Fix confirmed problems in the same working tree and report the rest.
2. Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`; commit only when all pass. Make one commit for the step; do not add a separate "fix issues found in review" commit.
3. Run the dev server for the user and tell the user how to check the new behavior in the browser (what to start, what to click, what they should see).

