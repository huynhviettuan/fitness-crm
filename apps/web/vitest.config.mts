import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside a React Server Components bundle; tests run
      // server code directly in Node.
      "server-only": path.resolve(import.meta.dirname, "tests/support/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.int.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          // Integration tests share one database, so files run one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
          },
        },
      },
    ],
  },
});
