import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { connect, e2eDatabaseUrl, resetAndSeedUsers } from "./db";

/** Migrates the E2E database and creates one account per role. */
export default async function globalSetup() {
  loadEnv({ quiet: true });
  execSync("npx prisma migrate deploy", {
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
