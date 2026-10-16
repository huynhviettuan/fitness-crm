import { execSync } from "node:child_process";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { connect, contractFixtures, e2eDatabaseUrl, resetAndSeedUsers } from "./db";

const API_DIR = path.join(import.meta.dirname, "..", "..", "apps", "api");

/** Migrates the E2E database, creates one account per role, and the service and salesperson contracts are made under. */
export default async function globalSetup() {
  loadEnv({ path: path.join(API_DIR, ".env"), quiet: true });
  execSync("pnpm exec prisma migrate deploy", {
    cwd: API_DIR,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() },
  });

  const prisma = connect();
  try {
    await resetAndSeedUsers(prisma);
  } finally {
    await prisma.$disconnect();
  }
  // Once, here: workers that make them on first use race, and a second salesperson makes choosing one ambiguous.
  await contractFixtures();
}
