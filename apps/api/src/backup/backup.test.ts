import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StreamingStorage } from "../platform/files/file.storage.js";
import {
  LATEST,
  backupKeyFor,
  openSealedFile,
  pgEnvironment,
  restoreBackup,
  sameDatabase,
  takeBackup,
  type Dump,
} from "./backup.js";

// M9.4b (A-312, A-318): the backup's streamed sealing, naming, pointer and restore guards. pg_dump and pg_restore themselves
// are run by the drill (doc 15), the CI image job and inside the API's image; here they are replaced at their boundary.

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "gymcrm-backup-test-"));
});
afterAll(() => rm(scratch, { recursive: true, force: true }));

/** A storage on a folder that records which call stored each object, so a test can tell a streamed copy from a buffer. */
function folderStorage(): StreamingStorage & { objects: Map<string, Buffer>; streamed: Set<string> } {
  const objects = new Map<string, Buffer>();
  const streamed = new Set<string>();
  return {
    objects,
    streamed,
    async put(key, bytes) {
      objects.set(key, Buffer.from(bytes));
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error(`missing ${key}`);
      return bytes;
    },
    async putFile(key, path, _contentType, file) {
      const bytes = await readFile(path);
      expect(bytes.length).toBe(file.bytes);
      objects.set(key, bytes);
      streamed.add(key);
    },
    async getToFile(key, path) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error(`missing ${key}`);
      await writeFile(path, bytes);
    },
  };
}

/** A dump that yields the given chunks, and finishes as told (a pg_dump that failed after writing, when given an error). */
function dumpOf(chunks: Buffer[], failure?: Error): Dump {
  return () => ({
    output: Readable.from(chunks),
    finished: failure ? new Promise((_, reject) => setTimeout(() => reject(failure), 10)) : Promise.resolve(),
  });
}

const key = randomBytes(32);
const LIVE = "postgresql://gym:live-secret@db.internal:5432/gym";
const DRILL = "postgresql://gym:drill-secret@db.internal:5432/gym_drill";

/** Opens a stored copy into a buffer through the same path a restore takes. */
async function openStored(storage: ReturnType<typeof folderStorage>, objectKey: string, withKey = key) {
  const sealed = join(scratch, `${randomBytes(4).toString("hex")}.enc`);
  const plain = `${sealed}.plain`;
  await writeFile(sealed, storage.objects.get(objectKey)!);
  await openSealedFile(withKey, sealed, plain);
  return readFile(plain);
}

describe("sealing a backup as it streams", () => {
  it("opens with its key and hides the dump", async () => {
    const storage = folderStorage();
    const record = await takeBackup({
      databaseUrl: LIVE,
      key,
      storage,
      dump: dumpOf([Buffer.from("PGDMP the "), Buffer.from("customers table")]),
    });
    const sealed = storage.objects.get(record.key)!;
    expect(sealed.subarray(0, 8).toString()).toBe("GYMCRMB2");
    expect(sealed.includes(Buffer.from("customers"))).toBe(false);
    expect(await openStored(storage, record.key)).toEqual(Buffer.from("PGDMP the customers table"));
  });

  it("carries a large dump through in pieces, never as one buffer", async () => {
    const storage = folderStorage();
    const chunks = Array.from({ length: 64 }, () => randomBytes(256 * 1024));
    const record = await takeBackup({ databaseUrl: LIVE, key, storage, dump: dumpOf(chunks) });
    expect(storage.streamed.has(record.key)).toBe(true);
    expect(record.bytes).toBe(16 * 1024 * 1024 + 8 + 12 + 16);
    // Buffer.equals, not toEqual: a deep comparison of 16 MB byte by byte runs the test worker out of memory.
    expect((await openStored(storage, record.key)).equals(Buffer.concat(chunks))).toBe(true);
  });

  it("seals an empty dump too", async () => {
    const storage = folderStorage();
    const record = await takeBackup({ databaseUrl: LIVE, key, storage, dump: dumpOf([]) });
    expect(await openStored(storage, record.key)).toEqual(Buffer.alloc(0));
  });

  it("refuses another key, a changed byte, a cut copy, or something else", async () => {
    const storage = folderStorage();
    const record = await takeBackup({ databaseUrl: LIVE, key, storage, dump: dumpOf([Buffer.from("PGDMP data")]) });
    await expect(openStored(storage, record.key, randomBytes(32))).rejects.toThrow(/cannot be opened/);

    const changed = Buffer.from(storage.objects.get(record.key)!);
    changed[25]! ^= 1;
    storage.objects.set("changed", changed);
    await expect(openStored(storage, "changed")).rejects.toThrow(/cannot be opened/);

    storage.objects.set("cut", storage.objects.get(record.key)!.subarray(0, -4));
    await expect(openStored(storage, "cut")).rejects.toThrow(/cannot be opened/);

    storage.objects.set("plain", Buffer.from("PGDMP a plain dump, never sealed"));
    await expect(openStored(storage, "plain")).rejects.toThrow(/Not a Gym CRM backup/);
  });
});

describe("the connection for pg_dump and pg_restore", () => {
  it("moves the password into the environment", () => {
    expect(pgEnvironment("postgresql://fl%40w:p%40ss@db.internal:6543/gym?sslmode=require")).toEqual({
      PGHOST: "db.internal",
      PGPORT: "6543",
      PGUSER: "fl@w",
      PGPASSWORD: "p@ss",
      PGDATABASE: "gym",
      PGSSLMODE: "require",
    });
    expect(pgEnvironment("postgres://u:p@[::1]/x").PGHOST).toBe("::1");
    expect(() => pgEnvironment("mysql://u:p@h/x")).toThrow();
    expect(() => pgEnvironment("postgresql://u:p@h/")).toThrow();
  });

  it("knows the same database under another user or address", () => {
    expect(sameDatabase(LIVE, "postgresql://other:x@db.internal:5432/gym?sslmode=require")).toBe(true);
    expect(sameDatabase("postgresql://u:p@localhost:5432/a", "postgresql://v:q@127.0.0.1:5432/a")).toBe(true);
    expect(sameDatabase(LIVE, DRILL)).toBe(false);
  });
});

describe("taking a backup", () => {
  it("stores the sealed dump under a dated name, then points latest at it", async () => {
    const storage = folderStorage();
    const record = await takeBackup({
      databaseUrl: LIVE,
      key,
      storage,
      dump: dumpOf([Buffer.from("PGDMP")]),
      now: new Date("2026-10-15T19:00:05Z"),
    });
    expect(record.key).toBe("backups/2026/10/gymcrm-20261015-190005.dump.enc");
    expect(JSON.parse(storage.objects.get(LATEST)!.toString())).toEqual(record);
    expect(storage.objects.get(LATEST)!.toString()).not.toContain("secret");
  });

  it("stores nothing when pg_dump fails, even after its output ended", async () => {
    const storage = folderStorage();
    await expect(
      takeBackup({
        databaseUrl: LIVE,
        key,
        storage,
        dump: dumpOf([Buffer.from("PGDMP half")], new Error("pg_dump failed (1)")),
      }),
    ).rejects.toThrow(/pg_dump failed/);
    expect(storage.objects.size).toBe(0);
  });

  it("names copies so that their order is their time", () => {
    expect(backupKeyFor(new Date("2026-01-02T03:04:05Z")) < backupKeyFor(new Date("2026-01-02T03:04:06Z"))).toBe(true);
  });
});

describe("restoring a backup", () => {
  async function stored() {
    const storage = folderStorage();
    const record = await takeBackup({ databaseUrl: LIVE, key, storage, dump: dumpOf([Buffer.from("PGDMP v1")]) });
    return { storage, record };
  }

  it("restores the latest copy into an empty database, from a checked plain file", async () => {
    const { storage, record } = await stored();
    const restored: [string, Buffer][] = [];
    const answer = await restoreBackup({
      from: "latest",
      into: DRILL,
      servedDatabaseUrl: LIVE,
      key,
      storage,
      isEmpty: async () => true,
      restore: async (url, path) => {
        const kept = join(scratch, "restored.dump");
        await copyFile(path, kept);
        restored.push([url, await readFile(kept)]);
      },
    });
    expect(answer.key).toBe(record.key);
    expect(restored).toEqual([[DRILL, Buffer.from("PGDMP v1")]]);
  });

  it("never writes over the database it serves, nor into one with tables", async () => {
    const { storage } = await stored();
    const restore = async () => {
      throw new Error("must not restore");
    };
    const base = { from: "latest", servedDatabaseUrl: LIVE, key, storage, restore };
    await expect(restoreBackup({ ...base, into: LIVE, isEmpty: async () => true })).rejects.toThrow(/this server uses/);
    await expect(restoreBackup({ ...base, into: DRILL, isEmpty: async () => false })).rejects.toThrow(
      /already has tables/,
    );
  });

  it("refuses a copy off its checksum, a damaged named copy before pg_restore runs, and a name outside the backups", async () => {
    const { storage, record } = await stored();
    const copy = Buffer.from(storage.objects.get(record.key)!);
    copy[22]! ^= 1;
    storage.objects.set(record.key, copy);
    let restoreRan = false;
    const base = {
      into: DRILL,
      servedDatabaseUrl: LIVE,
      key,
      storage,
      isEmpty: async () => true,
      restore: async () => {
        restoreRan = true;
      },
    };
    await expect(restoreBackup({ ...base, from: "latest" })).rejects.toThrow(/checksum/);
    await expect(restoreBackup({ ...base, from: record.key })).rejects.toThrow(/cannot be opened/);
    await expect(restoreBackup({ ...base, from: "../files/x.dump.enc" })).rejects.toThrow(/Not a backup key/);
    expect(restoreRan).toBe(false);
  });
});
