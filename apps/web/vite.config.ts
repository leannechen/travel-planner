import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The one .env sits at the repository root, beside the API's; Vite would otherwise look in apps/web.
  envDir: "../..",
  server: {
    // `npm run dev` picks a free API port per checkout and passes it here, so worktrees do not clash.
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 3001}` },
  },
});
