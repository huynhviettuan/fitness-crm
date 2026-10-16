import { describe, expect, it } from "vitest";
import { backupState, jobState, machineState } from "./system.domain.js";

const NOW = new Date("2026-10-20T10:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe("a job's state (A-321)", () => {
  it("is off when it does not run here, never before its first run", () => {
    expect(jobState("backup", null, NOW, false)).toBe("off");
    expect(jobState("mail", null, NOW)).toBe("never");
    expect(jobState("mail", { lastSucceededAt: null, lastFailedAt: null }, NOW)).toBe("never");
  });

  it("is ok within its limit and late after it, each job by its own", () => {
    expect(jobState("mail", { lastSucceededAt: minutesAgo(9), lastFailedAt: null }, NOW)).toBe("ok");
    expect(jobState("mail", { lastSucceededAt: minutesAgo(11), lastFailedAt: null }, NOW)).toBe("late");
    expect(jobState("backup", { lastSucceededAt: minutesAgo(25 * 60), lastFailedAt: null }, NOW)).toBe("ok");
    expect(jobState("backup", { lastSucceededAt: minutesAgo(27 * 60), lastFailedAt: null }, NOW)).toBe("late");
  });

  it("is failing when the last run failed, and ok again after a success", () => {
    expect(jobState("reminders", { lastSucceededAt: minutesAgo(5), lastFailedAt: minutesAgo(1) }, NOW)).toBe("failing");
    expect(jobState("reminders", { lastSucceededAt: null, lastFailedAt: minutesAgo(1) }, NOW)).toBe("failing");
    expect(jobState("reminders", { lastSucceededAt: minutesAgo(1), lastFailedAt: minutesAgo(5) }, NOW)).toBe("ok");
  });
});

describe("the backup's and a machine's state", () => {
  it("backups: never, ok within a day and a little, late after", () => {
    expect(backupState(null, NOW)).toBe("never");
    expect(backupState(minutesAgo(26 * 60 - 1), NOW)).toBe("ok");
    expect(backupState(minutesAgo(26 * 60 + 1), NOW)).toBe("late");
  });

  it("machines: off when switched off, never before a contact, silent after a day", () => {
    expect(machineState({ active: false, lastSeenAt: minutesAgo(1) }, NOW)).toBe("off");
    expect(machineState({ active: true, lastSeenAt: null }, NOW)).toBe("never");
    expect(machineState({ active: true, lastSeenAt: minutesAgo(23 * 60) }, NOW)).toBe("ok");
    expect(machineState({ active: true, lastSeenAt: minutesAgo(25 * 60) }, NOW)).toBe("silent");
  });
});
