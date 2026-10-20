#!/usr/bin/env bash
# Prepares a new git worktree: links the shared .env and installs dependencies.
# Run it once from inside the worktree. The database is shared: start it once from the main checkout
# with `npm run db:up`.
set -euo pipefail

root="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
here="$(git rev-parse --show-toplevel)"

if [ "$root" = "$here" ]; then
  echo "This is the main checkout; nothing to set up."
  exit 0
fi

if [ -f "$root/.env" ] && [ ! -e "$here/.env" ]; then
  ln -s "$root/.env" "$here/.env"
  echo "Linked .env from $root"
fi

cd "$here"
npm install
echo "Ready. Start the app with: npm run dev"
