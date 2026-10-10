import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

/** Applies migrations to the test database once before the integration suite. */
export default function setup() {
  loadEnv({ quiet: true });
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");
  // Integration tests truncate tables; never point them at the development database.
  if (testUrl === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL.");
  }

  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}
