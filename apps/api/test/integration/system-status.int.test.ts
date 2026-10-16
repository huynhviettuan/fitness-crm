import { afterEach, describe, expect, it } from "vitest";
import { reported } from "../../src/jobs.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import type { FileStorage } from "../../src/platform/files/file.storage.js";
import { getSystemStatus } from "../../src/platform/system/system.service.js";
import { recordJobRun } from "../../src/platform/system/system.repository.js";
import { resetDatabase } from "../support/database.js";
import { DEFAULT_BRANCH_ID, createTestUser, uniquePhone } from "../support/factories.js";

// The System status page (A-321): jobs, backups, the outbox and the check-in machines, for Admin only.
afterEach(async () => {
  await resetDatabase();
});

const NOW = new Date("2026-10-20T10:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

/** A backup storage whose pointer says the newest copy was made at `at`, or has none, or cannot be reached. */
function storageWith(latest: Date | null | "down"): FileStorage {
  return {
    async put() {},
    async get() {
      if (latest === "down") throw new Error("R2 get failed: 403");
      if (latest === null) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return Buffer.from(JSON.stringify({ key: "backups/x.dump.enc", createdAt: latest.toISOString(), bytes: 1234 }));
    },
  };
}

async function admin() {
  return (await createTestUser("ADMIN")).actor;
}

describe("the background jobs", () => {
  it("are never run, then ok, late, or failing, from what each run recorded", async () => {
    const actor = await admin();
    let status = await getSystemStatus(actor, NOW, { backupsOn: false });
    expect(status.jobs.map((job) => [job.name, job.state])).toEqual([
      ["reminders", "never"],
      ["mail", "never"],
      ["backup", "off"],
    ]);

    await recordJobRun("reminders", { succeeded: minutesAgo(2) });
    await recordJobRun("mail", { succeeded: minutesAgo(30) });
    status = await getSystemStatus(actor, NOW, { backupsOn: false });
    expect(status.jobs.find((job) => job.name === "reminders")!.state).toBe("ok");
    expect(status.jobs.find((job) => job.name === "mail")!.state).toBe("late");

    await recordJobRun("reminders", { failed: minutesAgo(1), error: "boom" });
    status = await getSystemStatus(actor, NOW, { backupsOn: false });
    expect(status.jobs.find((job) => job.name === "reminders")).toMatchObject({ state: "failing", lastError: "boom" });
  });

  it("record their own runs, and a failure scrubbed of personal data", async () => {
    await reported("mail", async () => {})();
    const ok = await prisma.jobRun.findUniqueOrThrow({ where: { name: "mail" } });
    expect(ok.lastStartedAt).not.toBeNull();
    expect(ok.lastSucceededAt).not.toBeNull();

    await expect(
      reported("reminders", async () => {
        throw new Error("could not email lan@example.com about 0912345678");
      })(),
    ).rejects.toThrow(/could not email/);
    const failed = await prisma.jobRun.findUniqueOrThrow({ where: { name: "reminders" } });
    expect(failed.lastFailedAt).not.toBeNull();
    expect(failed.lastError).toContain("could not email");
    expect(failed.lastError).not.toMatch(/lan@example\.com|0912345678/);
  });
});

describe("the backups", () => {
  it("are off without a key, then never, ok, late, or unreadable from the storage's pointer", async () => {
    const actor = await admin();
    const backupOf = async (latest: Date | null | "down", backupsOn = true) =>
      (await getSystemStatus(actor, NOW, { backupsOn, storage: storageWith(latest) })).backup;

    expect(await backupOf(null, false)).toEqual({ state: "off", lastAt: null, bytes: null });
    expect((await backupOf(null)).state).toBe("never");
    expect(await backupOf(minutesAgo(8 * 60))).toEqual({ state: "ok", lastAt: minutesAgo(8 * 60), bytes: 1234 });
    expect((await backupOf(minutesAgo(27 * 60))).state).toBe("late");
    expect((await backupOf("down")).state).toBe("unreadable");
  });
});

describe("the outbox and the machines", () => {
  it("counts queued, stuck and failed emails, and finds silent machines", async () => {
    const { actor } = await createTestUser("ADMIN");
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const person = await createCustomer(reception, { fullName: "Nguyễn Văn An", phone: uniquePhone() });
    const email = (status: "QUEUED" | "FAILED" | "SENT", createdAt: Date, dedupeKey: string) =>
      prisma.emailMessage.create({
        data: {
          personId: person.id,
          branchId: DEFAULT_BRANCH_ID,
          event: "session.credited",
          dedupeKey,
          locale: "vi",
          subject: "s",
          body: "b",
          status,
          createdAt,
          sentAt: status === "SENT" ? createdAt : null,
          failure: status === "FAILED" ? "providerRejected" : null,
        },
      });
    await email("QUEUED", minutesAgo(5), "a");
    await email("QUEUED", minutesAgo(45), "b");
    await email("FAILED", minutesAgo(60), "c");
    await email("SENT", minutesAgo(10), "d");
    for (const [name, lastSeenAt, active] of [
      ["Máy A", minutesAgo(60), true],
      ["Máy B", minutesAgo(30 * 60), true],
      ["Máy C", null, true],
      ["Máy D", null, false],
    ] as const) {
      await prisma.checkinDevice.create({
        data: { branchId: DEFAULT_BRANCH_ID, name, keyHash: `hash-${name}`, active, lastSeenAt },
      });
    }

    const status = await getSystemStatus(actor, NOW, { backupsOn: false });

    expect(status.emails).toEqual({ queued: 2, stuck: 1, failed: 1, lastSentAt: minutesAgo(10) });
    expect(status.machines.map((machine) => [machine.name, machine.state])).toEqual([
      ["Máy A", "ok"],
      ["Máy B", "silent"],
      ["Máy C", "never"],
      ["Máy D", "off"],
    ]);
    // Two jobs never run, a stuck email, a failed email, a silent and a never-seen machine.
    expect(status.attention).toBe(6);
  });
});

describe("who sees it", () => {
  it("is Admin's: other roles are refused", async () => {
    for (const role of ["FITNESS_MANAGER", "RECEPTIONIST", "ACCOUNTANT", "PT"] as const) {
      const { actor } = await createTestUser(role);
      await expect(getSystemStatus(actor, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("names settings only as on or off, never their values", async () => {
    const status = await getSystemStatus(await admin(), NOW, { backupsOn: false });
    expect(
      Object.values(status.settings).every((value) => typeof value === "boolean" || typeof value === "string"),
    ).toBe(true);
    const text = JSON.stringify(status);
    for (const secret of [process.env.FIELD_ENCRYPTION_KEY, process.env.BETTER_AUTH_SECRET, process.env.DATABASE_URL]) {
      if (secret) expect(text).not.toContain(secret);
    }
  });
});
