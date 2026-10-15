import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { StreamingStorage } from "../platform/files/file.storage.js";

// The database backups (M9.4b, A-312, A-318, doc 15): the worker's daily copy that does not depend on the database host.
// `pg_dump` in its custom format (compressed, restored table by table) → sealed with AES-256-GCM under
// BACKUP_ENCRYPTION_KEY → the backup storage, with a pointer to the latest one. Old copies are removed by the bucket's
// lifecycle rule (30 days), so this code never deletes. The database password never goes on a command line: pg_dump and
// pg_restore read it from their environment.
//
// Everything streams (A-318): pg_dump → seal → a temporary file → the storage, and back the same way, so memory stays
// small whatever the size of the database; only the temporary disk holds a copy, removed afterwards.
//
// Sealed form: "FLOWBAK2" | 12-byte IV | ciphertext | 16-byte auth tag. The tag comes last so the seal is written as the
// dump comes; a restore checks it to the last byte before pg_restore reads anything.

const MAGIC = Buffer.from("FLOWBAK2", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const LATEST = "backups/latest.json";

export type BackupKey = Buffer;

export function parseBackupKey(base64: string): BackupKey {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

/** A stream that seals what passes through it: the magic and IV first, then the ciphertext, the tag at the end. */
export function sealStream(key: BackupKey): Transform {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let started = false;
  const head = () => {
    if (started) return [];
    started = true;
    return [MAGIC, iv];
  };
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      done(null, Buffer.concat([...head(), cipher.update(chunk)]));
    },
    flush(done) {
      done(null, Buffer.concat([...head(), cipher.final(), cipher.getAuthTag()]));
    },
  });
}

/**
 * Opens a sealed file into a plain file. Throws when it is not a backup, was changed, or was sealed with another key; the
 * plain file is then incomplete and must not be used.
 */
export async function openSealedFile(key: BackupKey, sealedPath: string, plainPath: string): Promise<void> {
  const { size } = await stat(sealedPath);
  const headBytes = MAGIC.length + IV_BYTES;
  if (size < headBytes + TAG_BYTES) throw new Error("Not a Flow backup");
  const head = Buffer.alloc(headBytes);
  const tag = Buffer.alloc(TAG_BYTES);
  const handle = await open(sealedPath, "r");
  try {
    await handle.read(head, 0, headBytes, 0);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a Flow backup");
  const decipher = createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const bodyEnd = size - TAG_BYTES - 1;
  const body = bodyEnd >= headBytes ? createReadStream(sealedPath, { start: headBytes, end: bodyEnd }) : emptyStream();
  try {
    await pipeline(body, decipher, createWriteStream(plainPath));
  } catch {
    throw new Error("The backup cannot be opened: changed, damaged, or sealed with another key");
  }
}

function emptyStream(): Readable {
  const stream = new PassThrough();
  stream.end();
  return stream;
}

/** The SHA-256 (hex) and size of a file, read as a stream. */
export async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

/** A temporary folder for one backup or restore, always removed. */
async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "flow-backup-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
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

/** Starts a PostgreSQL client program: its output as a stream, and when it finished (rejected with its stderr, no password). */
function startPgProgram(program: string, args: string[], databaseUrl: string) {
  const child = spawn(program, args, {
    env: { ...process.env, ...pgEnvironment(databaseUrl) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const err: Buffer[] = [];
  child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    child.on("error", (error) => reject(new Error(`${program} could not start: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${program} failed (${code}): ${Buffer.concat(err).toString("utf8").trim().slice(0, 2000)}`));
    });
  });
  return { output: child.stdout!, finished };
}

/** A dump as it is produced, and when its program finished (rejected when it failed). */
export type Dump = (databaseUrl: string) => { output: Readable; finished: Promise<void> };
/** Restores the plain dump file into the database. */
export type Restore = (databaseUrl: string, dumpPath: string) => Promise<void>;

/** pg_dump's custom format, without owners and grants, so it restores into any database the restorer owns. */
export const pgDump: Dump = (databaseUrl) =>
  startPgProgram("pg_dump", ["--format=custom", "--no-owner", "--no-privileges"], databaseUrl);

/** pg_restore from the dump file into the database, stopping at the first error. */
export const pgRestore: Restore = async (databaseUrl, dumpPath) => {
  const { output, finished } = startPgProgram(
    "pg_restore",
    ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", pgEnvironment(databaseUrl).PGDATABASE!, dumpPath],
    databaseUrl,
  );
  output.resume();
  await finished;
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
  storage: StreamingStorage;
  dump?: Dump;
  now?: Date;
}): Promise<BackupRecord> {
  const now = input.now ?? new Date();
  const key = backupKeyFor(now);
  return withTempDir(async (dir) => {
    const sealedPath = join(dir, "backup.dump.enc");
    const { output, finished } = (input.dump ?? pgDump)(input.databaseUrl);
    // Both must succeed: the output can end cleanly while the program still reports a failure.
    await Promise.all([pipeline(output, sealStream(input.key), createWriteStream(sealedPath)), finished]);
    const file = await hashFile(sealedPath);
    await input.storage.putFile(key, sealedPath, "application/octet-stream", file);
    const record: BackupRecord = { key, createdAt: now.toISOString(), ...file };
    // The pointer is written last: it never names a copy that is not there.
    await input.storage.put(LATEST, Buffer.from(`${JSON.stringify(record, null, 2)}\n`), "application/json");
    return record;
  });
}

/** The latest backup's record, or the one named (its key; the checksum is then not known in advance). */
export async function findBackup(storage: StreamingStorage, from: string): Promise<BackupRecord | { key: string }> {
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
  storage: StreamingStorage;
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
  return withTempDir(async (dir) => {
    const sealedPath = join(dir, "backup.dump.enc");
    const plainPath = join(dir, "backup.dump");
    await input.storage.getToFile(found.key, sealedPath);
    if ("sha256" in found && (await hashFile(sealedPath)).sha256 !== found.sha256) {
      throw new Error("Refused: the copy does not match its recorded checksum");
    }
    await openSealedFile(input.key, sealedPath, plainPath);
    await (input.restore ?? pgRestore)(input.into, plainPath);
    return { key: found.key };
  });
}
