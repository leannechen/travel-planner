import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The one .env sits at the repository root, beside the API's; Vite would otherwise look in apps/web.
  envDir: "../..",
  server: {
    // `ws` lets the live collaboration connection (/api/live) through.
    // API_PORT lets a second checkout run its own API beside one already on 3001.
    proxy: { "/api": { target: `http://localhost:${process.env.API_PORT ?? 3001}`, ws: true } },
  },
});
