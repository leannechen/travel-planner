import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The one .env sits at the repository root, beside the API's; Vite would otherwise look in apps/web.
  envDir: "../..",
  server: {
    proxy: { "/api": "http://localhost:3001" },
  },
});
