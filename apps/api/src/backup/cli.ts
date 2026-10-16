import "dotenv/config";
import pg from "pg";
import { env } from "../platform/env.js";
import { backupStorage } from "../platform/files/file.storage.js";
import { parseBackupKey, restoreBackup, takeBackup } from "./backup.js";

// The backup command (M9.4b, A-312, doc 15):
//
//   pnpm --filter api backup:now                                       a backup now (also before every production migration)
//   pnpm --filter api backup:restore -- --into <empty database URL> [--from latest | backups/…/gymcrm-….dump.enc]
//
// The restore drill: in a shell with the backup key and bucket of the environment the copy came from, restore into a new,
// empty database (staging's drill database); the command prints the row counts to record with the drill.

const COUNTED = ["users", "customers", "contracts", "payments", "bookings", "sessions", "audit_events"] as const;

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function withClient<T>(databaseUrl: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function isEmptyDatabase(databaseUrl: string): Promise<boolean> {
  return withClient(databaseUrl, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')",
    );
    return rows[0]?.count === "0";
  });
}

/** The rows of the main tables, to compare the restored copy with the live system. */
export async function countRows(databaseUrl: string): Promise<Record<string, number>> {
  return withClient(databaseUrl, async (client) => {
    const counts: Record<string, number> = {};
    for (const table of COUNTED) {
      const { rows } = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}"`);
      counts[table] = Number(rows[0]?.count ?? 0);
    }
    return counts;
  });
}

function backupKey() {
  if (!env.BACKUP_ENCRYPTION_KEY) throw new Error("BACKUP_ENCRYPTION_KEY is not set");
  return parseBackupKey(env.BACKUP_ENCRYPTION_KEY);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "backup") {
    const record = await takeBackup({ databaseUrl: env.DATABASE_URL, key: backupKey(), storage: backupStorage });
    console.info(`Backup written: ${record.key} (${record.bytes} bytes, sha256 ${record.sha256})`);
    return;
  }
  if (command === "restore") {
    const into = arg("into");
    if (!into) throw new Error("--into <empty database URL> is required");
    const { key } = await restoreBackup({
      from: arg("from") ?? "latest",
      into,
      servedDatabaseUrl: env.DATABASE_URL,
      key: backupKey(),
      storage: backupStorage,
      isEmpty: isEmptyDatabase,
    });
    console.info(`Restored ${key}. Rows in the restored copy:`);
    for (const [table, count] of Object.entries(await countRows(into))) console.info(`  ${table.padEnd(14)} ${count}`);
    return;
  }
  throw new Error("Usage: cli.ts backup | restore --into <database URL> [--from latest|<key>]");
}

if (process.argv[1] && /backup[\\/]cli\.(ts|js)$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
