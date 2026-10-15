import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: path.join(import.meta.dirname, ".env"), quiet: true });

export default defineConfig({
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
          include: ["test/integration/**/*.int.test.ts"],
          globalSetup: ["test/integration/global-setup.ts"],
          // Each worker has its own database, cloned from the migrated test database (test/integration/worker-databases.ts).
          setupFiles: ["test/integration/worker-setup.ts"],
          maxWorkers: Math.max(1, Number(process.env.INTEGRATION_WORKERS ?? 4) || 1),
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            // Replaced per worker by worker-setup.ts.
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
          },
        },
      },
    ],
  },
});
