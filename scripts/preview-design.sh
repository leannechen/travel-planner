#!/usr/bin/env bash
# Serve the design source folder so each screen can be opened in a browser.
# Usage: scripts/preview-design.sh [port]   (default 4173)
set -euo pipefail
cd "$(dirname "$0")/../docs/design/source"
PORT="${1:-4173}"
echo "Design preview: http://localhost:${PORT}/  (open e.g. /01-desktop-workspace.dc.html)"
exec python3 -m http.server "${PORT}"
