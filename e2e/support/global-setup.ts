import { execSync } from "node:child_process";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { connect, e2eDatabaseUrl, resetAndSeedUsers } from "./db";

const WEB_DIR = path.join(import.meta.dirname, "..", "..", "apps", "web");

/** Migrates the E2E database and creates one account per role. */
export default async function globalSetup() {
  loadEnv({ path: path.join(WEB_DIR, ".env"), quiet: true });
  execSync("pnpm exec prisma migrate deploy", {
    cwd: WEB_DIR,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() },
  });

  const prisma = connect();
  try {
    await resetAndSeedUsers(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
