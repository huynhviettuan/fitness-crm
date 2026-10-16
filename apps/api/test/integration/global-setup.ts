import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { INTEGRATION_WORKERS, databaseName, workerDatabaseUrl } from "./worker-databases.js";

/**
 * Applies migrations to the test database once, then clones it for each worker (CREATE DATABASE … TEMPLATE), so the
 * files run in parallel, each worker on its own database.
 */
export default async function setup() {
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

  const template = databaseName(testUrl);
  const maintenance = new URL(testUrl);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    // A template must have no other session open (a left-over test run, a database tool).
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [template],
    );
    for (let worker = 1; worker <= INTEGRATION_WORKERS; worker += 1) {
      const name = databaseName(workerDatabaseUrl(testUrl, worker));
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await client.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    }
  } finally {
    await client.end();
  }
}
