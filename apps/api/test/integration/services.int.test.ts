import { afterEach, describe, expect, it } from "vitest";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { prisma } from "../../src/platform/db/prisma.js";
import {
  createService,
  getService,
  listServices,
  lookupPrice,
  saveQuickPackages,
  saveTiers,
  updateService,
} from "../../src/modules/services/service.service.js";
import { resetDatabase } from "../support/database.js";
import { DEFAULT_BRANCH_ID, createTestBranch, createTestUser } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

const today = calendarDateInTimeZone("Asia/Ho_Chi_Minh");
/** dd/MM/yyyy of the gym day `offset` days from today. */
const day = (offset: number) => {
  const date = new Date(today.getTime() + offset * 86_400_000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getUTCDate())}/${two(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
};

const tier = (min: number, max: number | null, unitPrice: number, months = 2, days = 0) => ({
  minSessions: min,
  maxSessions: max,
  unitPrice,
  validityMonths: months,
  validityDays: days,
});

const TIERS = [tier(1, 11, 700_000, 1), tier(12, 23, 650_000, 2), tier(36, null, 500_000, 6)];

async function admin() {
  return (await createTestUser("ADMIN", { allBranches: true })).actor;
}

async function hybrid(actor: Awaited<ReturnType<typeof admin>>, overrides: Record<string, unknown> = {}) {
  return createService(actor, { name: "Hybrid Training", kind: "PT", branchIds: [DEFAULT_BRANCH_ID], ...overrides });
}

describe("services (FR-SVC-001, D-021)", () => {
  it("creates a service with its branches and writes the audit event", async () => {
    const actor = await admin();

    const service = await hybrid(actor, {
      commissionRate: "30.5",
      allowedFrom: "06:00",
      allowedTo: "21:00",
      maxPerWeek: "3",
    });

    expect(service).toMatchObject({
      name: "Hybrid Training",
      kind: "PT",
      commissionRate: 30.5,
      allowedFrom: "06:00",
      allowedTo: "21:00",
      maxPerWeek: 3,
      active: true,
      currentVersion: null,
      versions: [],
      quickPackages: [],
    });
    expect(service.branches.map((b) => b.id)).toEqual([DEFAULT_BRANCH_ID]);
    const audit = await prisma.auditEvent.findMany({ where: { entityId: service.id } });
    expect(audit).toEqual([expect.objectContaining({ action: "service.created", actorUserId: actor.id })]);
  });

  it("refuses a name in use (any case), a branch that does not exist, and a group without a limit", async () => {
    const actor = await admin();
    await hybrid(actor);

    await expect(hybrid(actor, { name: "hybrid training" })).rejects.toMatchObject({
      fieldErrors: { name: ["nameTaken"] },
    });
    await expect(
      hybrid(actor, { name: "Other", branchIds: ["b0000000-0000-4000-8000-0000000000ff"] }),
    ).rejects.toMatchObject({
      fieldErrors: { branchIds: ["invalidChoice"] },
    });
    await expect(hybrid(actor, { name: "Family", isGroup: true })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("updates every field and audits only what changed; the service is never deleted", async () => {
    const actor = await admin();
    const branch = await createTestBranch();
    const service = await hybrid(actor);

    const updated = await updateService(actor, service.id, {
      name: "Hybrid Training",
      kind: "PT",
      branchIds: [DEFAULT_BRANCH_ID, branch.id],
      commissionRate: 25,
      active: false,
    });

    expect(updated).toMatchObject({ commissionRate: 25, active: false });
    expect(updated.branches).toHaveLength(2);
    const [, update] = await prisma.auditEvent.findMany({
      where: { entityId: service.id },
      orderBy: { createdAt: "asc" },
    });
    expect(update).toMatchObject({
      action: "service.updated",
      before: { commissionRate: 100, active: true },
      after: { commissionRate: 25, active: false },
    });
  });

  it("lists by branch for those who only sell, and every service for Admin; on sale hides the inactive and out of date", async () => {
    const actor = await admin();
    const other = await createTestBranch();
    await hybrid(actor, { name: "Alpha" });
    await hybrid(actor, { name: "Elsewhere", branchIds: [other.id] });
    await hybrid(actor, { name: "Off", active: false });
    await hybrid(actor, { name: "Future", activeFrom: day(10) });
    await hybrid(actor, { name: "Past", activeTo: day(-1) });
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    expect((await listServices(actor, {})).map((s) => s.name).sort()).toEqual([
      "Alpha",
      "Elsewhere",
      "Future",
      "Off",
      "Past",
    ]);
    expect((await listServices(reception, {})).map((s) => s.name).sort()).toEqual(["Alpha", "Future", "Off", "Past"]);
    expect((await listServices(reception, { onSale: "true" })).map((s) => s.name)).toEqual(["Alpha"]);
    expect((await listServices(actor, { branchId: other.id })).map((s) => s.name)).toEqual(["Elsewhere"]);
    await expect(
      getService(reception, (await listServices(actor, { branchId: other.id }))[0]!.id),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("price tiers in versions (FR-SVC-002, BR-301)", () => {
  it("saves the first version from any day, numbers the next, and keeps the history", async () => {
    const actor = await admin();
    const service = await hybrid(actor);

    const first = await saveTiers(actor, service.id, { effectiveFrom: day(-30), tiers: TIERS });
    expect(first.versions).toHaveLength(1);
    expect(first.versions[0]).toMatchObject({ version: 1, createdBy: actor.name });
    expect(first.versions[0]!.tiers.map((t) => [t.minSessions, t.maxSessions, t.unitPrice])).toEqual([
      [1, 11, 700_000],
      [12, 23, 650_000],
      [36, null, 500_000],
    ]);
    expect(first.currentVersion).toBe(1);

    const second = await saveTiers(actor, service.id, { effectiveFrom: day(5), tiers: [tier(1, 100, 800_000)] });
    expect(second.versions.map((v) => v.version)).toEqual([1, 2]);
    // The second has not started: version 1 is still in force.
    expect(second.currentVersion).toBe(1);
    const audit = await prisma.auditEvent.findMany({ where: { action: "price_tier_version.created" } });
    expect(audit).toHaveLength(2);
  });

  it("starts a later version today or after, and after the one before it", async () => {
    const actor = await admin();
    const service = await hybrid(actor);
    await saveTiers(actor, service.id, { effectiveFrom: day(3), tiers: TIERS });

    await expect(saveTiers(actor, service.id, { effectiveFrom: day(3), tiers: TIERS })).rejects.toMatchObject({
      fieldErrors: { effectiveFrom: ["effectiveAfterLatest"] },
    });
    await expect(saveTiers(actor, service.id, { effectiveFrom: day(1), tiers: TIERS })).rejects.toMatchObject({
      fieldErrors: { effectiveFrom: ["effectiveAfterLatest"] },
    });
    const later = await saveTiers(actor, service.id, { effectiveFrom: day(4), tiers: TIERS });
    expect(later.versions).toHaveLength(2);
  });

  it("refuses a past day for a later version", async () => {
    const actor = await admin();
    const service = await hybrid(actor);
    await saveTiers(actor, service.id, { effectiveFrom: day(-40), tiers: TIERS });

    await expect(saveTiers(actor, service.id, { effectiveFrom: day(-5), tiers: TIERS })).rejects.toMatchObject({
      fieldErrors: { effectiveFrom: ["effectiveInPast"] },
    });
  });

  it("refuses overlapping tiers, an open tier that is not last, and a tier without validity", async () => {
    const actor = await admin();
    const service = await hybrid(actor);
    const save = (tiers: unknown[]) => saveTiers(actor, service.id, { effectiveFrom: day(0), tiers });

    await expect(save([tier(1, 12, 1), tier(12, 24, 1)])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(save([tier(1, null, 1), tier(12, 24, 1)])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(save([tier(1, 12, 1, 0, 0)])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await prisma.priceTierVersion.count()).toBe(0);
  });

  it("is also protected by the database: tiers of one version cannot overlap", async () => {
    const actor = await admin();
    const service = await hybrid(actor);
    const { versions } = await saveTiers(actor, service.id, { effectiveFrom: day(0), tiers: [tier(1, 11, 1)] });

    await expect(
      prisma.priceTier.create({
        data: {
          versionId: versions[0]!.id,
          minSessions: 11,
          maxSessions: 20,
          unitPrice: 1,
          validityMonths: 1,
          validityDays: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it("gives two saves at once different numbers", async () => {
    const actor = await admin();
    const service = await hybrid(actor);

    const results = await Promise.allSettled([
      saveTiers(actor, service.id, { effectiveFrom: day(1), tiers: TIERS }),
      saveTiers(actor, service.id, { effectiveFrom: day(2), tiers: TIERS }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const numbers = (await prisma.priceTierVersion.findMany({ where: { serviceId: service.id } })).map(
      (v) => v.version,
    );
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("the price lookup (BR-301, AC-10)", () => {
  async function priced() {
    const actor = await admin();
    const service = await hybrid(actor);
    await saveTiers(actor, service.id, { effectiveFrom: day(-60), tiers: TIERS });
    return { actor, service };
  }

  it("gives the tier's unit price, the total, the name, and the end date for any count in range", async () => {
    const { actor, service } = await priced();

    expect(await lookupPrice(actor, service.id, { sessions: "11", startDate: "01/10/2026" })).toMatchObject({
      sessions: 11,
      unitPrice: 700_000,
      total: 7_700_000,
      validityMonths: 1,
      displayName: "Hybrid Training 11 buổi",
      endDate: new Date("2026-10-31T00:00:00.000Z"),
    });
    expect(await lookupPrice(actor, service.id, { sessions: "12", startDate: "15/10/2026" })).toMatchObject({
      unitPrice: 650_000,
      total: 7_800_000,
      endDate: new Date("2026-12-14T00:00:00.000Z"),
    });
    expect(await lookupPrice(actor, service.id, { sessions: "500" })).toMatchObject({
      unitPrice: 500_000,
      total: 250_000_000,
      endDate: null,
    });
  });

  it("refuses a count that no tier covers instead of using a nearby tier (A-107)", async () => {
    const { actor, service } = await priced();

    for (const sessions of ["24", "35"]) {
      await expect(lookupPrice(actor, service.id, { sessions })).rejects.toMatchObject({
        fieldErrors: { sessions: ["noPriceTier"] },
      });
    }
    await expect(lookupPrice(actor, service.id, { sessions: "0" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(lookupPrice(actor, service.id, { sessions: "abc" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("uses the version in force on the day asked, so an old contract keeps its price", async () => {
    const { actor, service } = await priced();
    await saveTiers(actor, service.id, { effectiveFrom: day(10), tiers: [tier(1, 100, 900_000)] });

    expect(await lookupPrice(actor, service.id, { sessions: "5" })).toMatchObject({ version: 1, unitPrice: 700_000 });
    expect(await lookupPrice(actor, service.id, { sessions: "5", asOf: day(10) })).toMatchObject({
      version: 2,
      unitPrice: 900_000,
    });
    expect(await lookupPrice(actor, service.id, { sessions: "5", asOf: day(9) })).toMatchObject({ version: 1 });
    await expect(lookupPrice(actor, service.id, { sessions: "5", asOf: day(-61) })).rejects.toMatchObject({
      fieldErrors: { sessions: ["noPriceVersion"] },
    });
  });

  it("is read by those who sell in the service's branches only", async () => {
    const { service } = await priced();
    const other = await createTestBranch();
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: elsewhere } = await createTestUser("RECEPTIONIST", { branchIds: [other.id] });

    expect(await lookupPrice(reception, service.id, { sessions: "5" })).toMatchObject({ unitPrice: 700_000 });
    await expect(lookupPrice(elsewhere, service.id, { sessions: "5" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lookupPrice(reception, "not-a-uuid", { sessions: "5" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("quick-pick packages (FR-SVC-003)", () => {
  it("replaces the counts, keeps them in order, and audits a change", async () => {
    const actor = await admin();
    const service = await hybrid(actor);

    const saved = await saveQuickPackages(actor, service.id, { sessions: [30, 12, 24] });
    expect(saved.quickPackages).toEqual([12, 24, 30]);
    await saveQuickPackages(actor, service.id, { sessions: [12, 24, 30] });
    expect((await saveQuickPackages(actor, service.id, { sessions: [12] })).quickPackages).toEqual([12]);

    const audit = await prisma.auditEvent.findMany({ where: { action: "service.quick_packages_updated" } });
    expect(audit).toHaveLength(2);
    await expect(saveQuickPackages(actor, service.id, { sessions: [12, 12] })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("who may do what (09_RBAC.md)", () => {
  it("lets everyone who sells read, and only Admin create or edit", async () => {
    const actor = await admin();
    const service = await hybrid(actor);
    await saveTiers(actor, service.id, { effectiveFrom: day(0), tiers: TIERS });

    for (const role of ["RECEPTIONIST", "CONSULTING", "FITNESS_MANAGER", "ACCOUNTANT"] as const) {
      const { actor: user } = await createTestUser(role);
      expect(await getService(user, service.id)).toMatchObject({ name: "Hybrid Training" });
      await expect(hybrid(user, { name: `X ${role}` })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(saveTiers(user, service.id, { effectiveFrom: day(5), tiers: TIERS })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(saveQuickPackages(user, service.id, { sessions: [5] })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        updateService(user, service.id, { name: "Hybrid Training", kind: "PT", branchIds: [DEFAULT_BRANCH_ID] }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    const { actor: trainer } = await createTestUser("PT");
    await expect(getService(trainer, service.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
