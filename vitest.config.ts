import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "shared", root: "packages/shared", environment: "node" } },
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
