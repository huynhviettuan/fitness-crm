import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";
import { GRAPH_STUB_PORT } from "./support/graph";

const API_DIR = path.join(import.meta.dirname, "..", "apps", "api");
const WEB_DIR = path.join(import.meta.dirname, "..", "apps", "web");

// E2E_DATABASE_URL lives with the API's other settings.
loadEnv({ path: path.join(API_DIR, ".env"), quiet: true });

const PORT = 3100;
const API_PORT = 4100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./support/global-setup.ts",
  use: {
    baseURL,
    // The UI language is pinned so labels can be read from messages/vi.json (docs/13).
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: [/rate-limit\.spec\.ts/, /\.branch\.spec\.ts/],
    },
    {
      // Specs that make a branch of their own (e.g. two consultants and their round-robin).
      // While it exists, users of every branch must say which branch a new record goes to
      // (D-014), so these run after the specs that rely on there being one.
      name: "own-branch",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /\.branch\.spec\.ts/,
      dependencies: ["chromium"],
    },
    {
      // Exhausts the sign-in rate limit, so it runs after everything else.
      name: "rate-limit",
      testMatch: /rate-limit\.spec\.ts/,
      dependencies: ["own-branch"],
    },
  ],
  // Tests run against production builds (`pnpm test:e2e` builds first): they behave like
  // the deployed apps (CSP without 'unsafe-eval', rate limiting) and use their own ports,
  // so they do not collide with a developer's own `pnpm dev`. Browsers talk only to the
  // web app, which forwards /api/* to the API (T-053).
  webServer: [
    {
      // The API answers its readiness check from the database, so the schema must exist before it starts: on a fresh
      // database (CI) the global setup would run too late.
      command: "pnpm exec prisma migrate deploy && node dist/main.js",
      cwd: API_DIR,
      url: `http://localhost:${API_PORT}/api/v1/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
        BETTER_AUTH_URL: baseURL,
        // Reminders run on a clock; the integration tests drive them with a fixed time (T-059).
        RUN_JOBS: "false",
        META_GRAPH_URL: `http://localhost:${GRAPH_STUB_PORT}/v21.0`,
      },
    },
    {
      command: "node support/graph-stub.mjs",
      cwd: import.meta.dirname,
      url: `http://localhost:${GRAPH_STUB_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      env: { GRAPH_STUB_PORT: String(GRAPH_STUB_PORT) },
    },
    {
      command: `pnpm exec next start --port ${PORT}`,
      cwd: WEB_DIR,
      url: `${baseURL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
