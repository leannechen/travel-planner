import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "shared", root: "packages/shared", environment: "node" } },
      // The Map View tests need the sample map, whatever key the developer's .env holds.
      { test: { name: "web", root: "apps/web", environment: "node", env: { VITE_GOOGLE_MAPS_API_KEY: "" } } },
      {
        test: {
          name: "api",
          root: "apps/api",
          environment: "node",
          globalSetup: "./test/global-setup.ts",
          fileParallelism: false,
        },
      },
    ],
  },
});
