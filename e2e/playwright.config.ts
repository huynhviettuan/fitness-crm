import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// E2E_DATABASE_URL lives with the app's other settings.
loadEnv({ path: path.join(import.meta.dirname, "..", "apps", "web", ".env"), quiet: true });

const PORT = 3100;
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
      testIgnore: /rate-limit\.spec\.ts/,
    },
    {
      // Exhausts the sign-in rate limit, so it runs after everything else.
      name: "rate-limit",
      testMatch: /rate-limit\.spec\.ts/,
      dependencies: ["chromium"],
    },
  ],
  // Tests run against a production build (`pnpm test:e2e` builds first): it behaves
  // like the deployed app (CSP without 'unsafe-eval', rate limiting) and does not
  // collide with a developer's own `next dev` (Next.js allows one per folder).
  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    cwd: path.join(import.meta.dirname, "..", "apps", "web"),
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      BETTER_AUTH_URL: baseURL,
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
