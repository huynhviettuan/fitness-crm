import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FileStorage } from "../platform/files/file.storage.js";
import {
  LATEST,
  backupKeyFor,
  openBackup,
  pgEnvironment,
  restoreBackup,
  sameDatabase,
  sealBackup,
  takeBackup,
} from "./backup.js";

// M9.4b (A-312): the backup's sealing, naming, pointer and restore guards. pg_dump and pg_restore themselves are run by the
// drill (doc 15) and inside the API's image; here they are replaced at their boundary.

function memoryStorage(): FileStorage & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async put(key, bytes) {
      objects.set(key, Buffer.from(bytes));
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error(`missing ${key}`);
      return bytes;
    },
  };
}

const key = randomBytes(32);
const LIVE = "postgresql://flow:live-secret@db.internal:5432/flow";
const DRILL = "postgresql://flow:drill-secret@db.internal:5432/flow_drill";

describe("sealing a backup", () => {
  it("opens with its key and hides the dump", () => {
    const dump = Buffer.from("PGDMP the customers table");
    const sealed = sealBackup(key, dump);
    expect(sealed.includes(Buffer.from("customers"))).toBe(false);
    expect(openBackup(key, sealed)).toEqual(dump);
  });

  it("refuses another key, a changed byte, or something else", () => {
    const sealed = sealBackup(key, Buffer.from("PGDMP"));
    expect(() => openBackup(randomBytes(32), sealed)).toThrow(/cannot be opened/);
    const changed = Buffer.from(sealed);
    changed[changed.length - 1]! ^= 1;
    expect(() => openBackup(key, changed)).toThrow(/cannot be opened/);
    expect(() => openBackup(key, Buffer.from("PGDMP plain dump"))).toThrow(/Not a Flow backup/);
  });
});

describe("the connection for pg_dump and pg_restore", () => {
  it("moves the password into the environment", () => {
    expect(pgEnvironment("postgresql://fl%40w:p%40ss@db.internal:6543/flow?sslmode=require")).toEqual({
      PGHOST: "db.internal",
      PGPORT: "6543",
      PGUSER: "fl@w",
      PGPASSWORD: "p@ss",
      PGDATABASE: "flow",
      PGSSLMODE: "require",
    });
    expect(pgEnvironment("postgres://u:p@[::1]/x").PGHOST).toBe("::1");
    expect(() => pgEnvironment("mysql://u:p@h/x")).toThrow();
    expect(() => pgEnvironment("postgresql://u:p@h/")).toThrow();
  });

  it("knows the same database under another user or address", () => {
    expect(sameDatabase(LIVE, "postgresql://other:x@db.internal:5432/flow?sslmode=require")).toBe(true);
    expect(sameDatabase("postgresql://u:p@localhost:5432/a", "postgresql://v:q@127.0.0.1:5432/a")).toBe(true);
    expect(sameDatabase(LIVE, DRILL)).toBe(false);
  });
});

describe("taking a backup", () => {
  it("stores the sealed dump under a dated name, then points latest at it", async () => {
    const storage = memoryStorage();
    const record = await takeBackup({
      databaseUrl: LIVE,
      key,
      storage,
      dump: async () => Buffer.from("PGDMP"),
      now: new Date("2026-10-15T19:00:05Z"),
    });
    expect(record.key).toBe("backups/2026/10/flow-20261015-190005.dump.enc");
    expect(openBackup(key, storage.objects.get(record.key)!)).toEqual(Buffer.from("PGDMP"));
    expect(JSON.parse(storage.objects.get(LATEST)!.toString())).toEqual(record);
    expect(storage.objects.get(LATEST)!.toString()).not.toContain("secret");
  });

  it("leaves latest alone when the dump fails", async () => {
    const storage = memoryStorage();
    await expect(
      takeBackup({ databaseUrl: LIVE, key, storage, dump: () => Promise.reject(new Error("pg_dump failed (1)")) }),
    ).rejects.toThrow(/pg_dump failed/);
    expect(storage.objects.size).toBe(0);
  });

  it("names copies so that their order is their time", () => {
    expect(backupKeyFor(new Date("2026-01-02T03:04:05Z")) < backupKeyFor(new Date("2026-01-02T03:04:06Z"))).toBe(true);
  });
});

describe("restoring a backup", () => {
  async function stored() {
    const storage = memoryStorage();
    const record = await takeBackup({ databaseUrl: LIVE, key, storage, dump: async () => Buffer.from("PGDMP v1") });
    return { storage, record };
  }

  it("restores the latest copy into an empty database", async () => {
    const { storage, record } = await stored();
    const restored: [string, Buffer][] = [];
    const answer = await restoreBackup({
      from: "latest",
      into: DRILL,
      servedDatabaseUrl: LIVE,
      key,
      storage,
      isEmpty: async () => true,
      restore: async (url, dump) => void restored.push([url, dump]),
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

  it("refuses a copy that does not match its checksum, and a name outside the backups", async () => {
    const { storage, record } = await stored();
    const copy = Buffer.from(storage.objects.get(record.key)!);
    copy[20]! ^= 1;
    storage.objects.set(record.key, copy);
    const base = {
      into: DRILL,
      servedDatabaseUrl: LIVE,
      key,
      storage,
      isEmpty: async () => true,
      restore: async () => {},
    };
    await expect(restoreBackup({ ...base, from: "latest" })).rejects.toThrow(/checksum/);
    await expect(restoreBackup({ ...base, from: record.key })).rejects.toThrow(/cannot be opened/);
    await expect(restoreBackup({ ...base, from: "../files/x.dump.enc" })).rejects.toThrow(/Not a backup key/);
  });
});
