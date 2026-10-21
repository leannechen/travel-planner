import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The one .env sits at the repository root, beside the API's; Vite would otherwise look in apps/web.
  envDir: "../..",
  server: {
    // `ws` lets the live collaboration connection (/api/live) through.
    proxy: { "/api": { target: "http://localhost:3001", ws: true } },
  },
});
