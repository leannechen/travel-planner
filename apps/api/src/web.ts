import path from "node:path";
import express from "express";

// Serves the built web app (apps/web/dist) from the API, so production is one server on one origin:
// the page, /api and the live socket share an address, as the Vite proxy makes them do in development.
// Files under /assets carry a hash in their name and are kept for a year; anything else (index.html,
// logo, landing images) is checked again on every load, so a new deploy shows at once. Any other GET
// outside /api answers index.html, because the web app reads its own paths (/trip/<id>, /t/<secret>);
// a missing file (a path with an extension, such as an old chunk asked for by a tab opened before a
// deploy) answers 404 instead, so the browser does not get HTML where it expects a script. No other
// site may show the app in a frame, where it could be made to click Delete or Share.
export function serveWeb(dir: string): express.Handler {
  const root = path.resolve(dir);
  const index = path.join(root, "index.html");
  const files = express.static(root, {
    index: false,
    setHeaders: (res, file) => {
      res.setHeader("Cache-Control", file.startsWith(path.join(root, "assets") + path.sep) ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });
  return (req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path === "/api" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    files(req, res, () => {
      if (path.extname(req.path)) {
        res.status(404).end();
        return;
      }
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(index, (err) => err && next(err));
    });
  };
}
