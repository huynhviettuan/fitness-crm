import { workerDatabaseUrl } from "./worker-databases.js";

// Runs in each worker before a test file imports anything: the file's database is this worker's clone, so env.ts and
// the Prisma client read it when the file imports them.
const testUrl = process.env.TEST_DATABASE_URL;
const worker = Number(process.env.VITEST_POOL_ID ?? 1);
if (testUrl) process.env.DATABASE_URL = workerDatabaseUrl(testUrl, worker);
