import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "@playwright/test";

// The README's screenshots and flow GIFs (docs/images): the built apps against a database filled by `pnpm db:seed` and
// `pnpm db:seed:demo`, in English. Not a test suite: `pnpm --filter e2e tour` after `pnpm build`.
//
//   TOUR_DATABASE_URL   the demo database (default: gymcrm_demo on the local Docker PostgreSQL)
//   TOUR_EMAIL, TOUR_PASSWORD   the admin to sign in as (default: SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD of apps/api/.env)

const API_DIR = path.join(import.meta.dirname, "..", "apps", "api");
const WEB_DIR = path.join(import.meta.dirname, "..", "apps", "web");
loadEnv({ path: path.join(API_DIR, ".env"), quiet: true });

const PORT = 3300;
const API_PORT = 4300;
const DATABASE_URL = process.env.TOUR_DATABASE_URL ?? "postgresql://fitness:fitness@localhost:5432/gymcrm_demo";

export default defineConfig({
  testDir: "./tour",
  testMatch: /\.capture\.ts$/,
  workers: 1,
  timeout: 300_000,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "en-US",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1600, height: 1000 },
    colorScheme: "light",
  },
  webServer: [
    {
      command: "node dist/main.js",
      cwd: API_DIR,
      url: `http://localhost:${API_PORT}/api/v1/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL,
        BETTER_AUTH_URL: `http://localhost:${PORT}`,
        // The jobs run, so the System status page shows them working.
        RUN_JOBS: "true",
      },
    },
    {
      command: `pnpm exec next start --port ${PORT}`,
      cwd: WEB_DIR,
      url: `http://localhost:${PORT}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
