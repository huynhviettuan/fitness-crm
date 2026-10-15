import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { FileStorage } from "../platform/files/file.storage.js";

// The database backups (M9.4b, A-312, doc 15): the worker's daily copy that does not depend on the database host.
// `pg_dump` in its custom format (compressed, restored table by table) → sealed with AES-256-GCM under
// BACKUP_ENCRYPTION_KEY → the backup storage, with a pointer to the latest one. Old copies are removed by the bucket's
// lifecycle rule (30 days), so this code never deletes. The database password never goes on a command line: pg_dump and
// pg_restore read it from their environment.
//
// Sealed form: "FLOWBAK1" | 12-byte IV | 16-byte auth tag | ciphertext.

const MAGIC = Buffer.from("FLOWBAK1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const LATEST = "backups/latest.json";

export type BackupKey = Buffer;

export function parseBackupKey(base64: string): BackupKey {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function sealBackup(key: BackupKey, plain: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

/** Throws when the copy is not a backup, was changed, or was sealed with another key: a damaged copy never restores. */
export function openBackup(key: BackupKey, sealed: Buffer): Buffer {
  if (sealed.length < MAGIC.length + IV_BYTES + TAG_BYTES || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Not a Flow backup");
  }
  const iv = sealed.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = sealed.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(sealed.subarray(MAGIC.length + IV_BYTES + TAG_BYTES)), decipher.final()]);
  } catch {
    throw new Error("The backup cannot be opened: changed, damaged, or sealed with another key");
  }
}

/** The libpq settings for a connection string, so the password travels in the child's environment, not its arguments. */
export function pgEnvironment(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error("Not a PostgreSQL connection string");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("The connection string names no database");
  const sslmode = url.searchParams.get("sslmode");
  return {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    ...(sslmode ? { PGSSLMODE: sslmode } : {}),
  };
}

/** The same database (host, port, name), whatever the user or options: the restore never writes over the one it serves. */
export function sameDatabase(a: string, b: string): boolean {
  const left = pgEnvironment(a);
  const right = pgEnvironment(b);
  const host = (value: string) => (value === "127.0.0.1" || value === "::1" ? "localhost" : value.toLowerCase());
  return (
    host(left.PGHOST!) === host(right.PGHOST!) && left.PGPORT === right.PGPORT && left.PGDATABASE === right.PGDATABASE
  );
}

/** Runs a PostgreSQL client program; its output, or an error with what it wrote to stderr (which holds no password). */
export function runPgProgram(program: string, args: string[], databaseUrl: string, input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      env: { ...process.env, ...pgEnvironment(databaseUrl) },
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => reject(new Error(`${program} could not start: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else
        reject(new Error(`${program} failed (${code}): ${Buffer.concat(err).toString("utf8").trim().slice(0, 2000)}`));
    });
    if (input && child.stdin) child.stdin.end(input);
  });
}

export type Dump = (databaseUrl: string) => Promise<Buffer>;
export type Restore = (databaseUrl: string, dump: Buffer) => Promise<void>;

/** pg_dump's custom format, without owners and grants, so it restores into any database the restorer owns. */
export const pgDump: Dump = (databaseUrl) =>
  runPgProgram("pg_dump", ["--format=custom", "--no-owner", "--no-privileges"], databaseUrl);

/** pg_restore from stdin into the database, stopping at the first error. */
export const pgRestore: Restore = async (databaseUrl, dump) => {
  await runPgProgram(
    "pg_restore",
    ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", pgEnvironment(databaseUrl).PGDATABASE!],
    databaseUrl,
    dump,
  );
};

export type BackupRecord = {
  key: string;
  createdAt: string;
  /** Size of the sealed copy. */
  bytes: number;
  /** SHA-256 of the sealed copy, checked before a restore. */
  sha256: string;
};

const pad = (value: number) => String(value).padStart(2, "0");

/** backups/2026/10/flow-20261015-190000.dump.enc (UTC): sorted by name is sorted by time. */
export function backupKeyFor(now: Date): string {
  const [y, m, d] = [now.getUTCFullYear(), pad(now.getUTCMonth() + 1), pad(now.getUTCDate())];
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `backups/${y}/${m}/flow-${y}${m}${d}-${time}.dump.enc`;
}

export async function takeBackup(input: {
  databaseUrl: string;
  key: BackupKey;
  storage: FileStorage;
  dump?: Dump;
  now?: Date;
}): Promise<BackupRecord> {
  const now = input.now ?? new Date();
  const sealed = sealBackup(input.key, await (input.dump ?? pgDump)(input.databaseUrl));
  const record: BackupRecord = {
    key: backupKeyFor(now),
    createdAt: now.toISOString(),
    bytes: sealed.length,
    sha256: createHash("sha256").update(sealed).digest("hex"),
  };
  await input.storage.put(record.key, sealed, "application/octet-stream");
  // The pointer is written last: it never names a copy that is not there.
  await input.storage.put(LATEST, Buffer.from(`${JSON.stringify(record, null, 2)}\n`), "application/json");
  return record;
}

/** The latest backup's record, or the one named (its key; the checksum is then not known in advance). */
export async function findBackup(storage: FileStorage, from: string): Promise<BackupRecord | { key: string }> {
  if (from !== "latest") {
    if (!/^backups\/[\w/.-]+\.dump\.enc$/.test(from) || from.includes("..")) throw new Error("Not a backup key");
    return { key: from };
  }
  return JSON.parse((await storage.get(LATEST)).toString("utf8")) as BackupRecord;
}

/** Restores a backup into an empty database that is not the one this process serves. */
export async function restoreBackup(input: {
  from: string;
  into: string;
  servedDatabaseUrl: string;
  key: BackupKey;
  storage: FileStorage;
  isEmpty: (databaseUrl: string) => Promise<boolean>;
  restore?: Restore;
}): Promise<{ key: string }> {
  if (sameDatabase(input.into, input.servedDatabaseUrl)) {
    throw new Error("Refused: the target is the database this server uses. Restore into a new, empty database.");
  }
  if (!(await input.isEmpty(input.into))) {
    throw new Error("Refused: the target database already has tables. Restore into a new, empty database.");
  }
  const found = await findBackup(input.storage, input.from);
  const sealed = await input.storage.get(found.key);
  if ("sha256" in found && createHash("sha256").update(sealed).digest("hex") !== found.sha256) {
    throw new Error("Refused: the copy does not match its recorded checksum");
  }
  await (input.restore ?? pgRestore)(input.into, openBackup(input.key, sealed));
  return { key: found.key };
}
