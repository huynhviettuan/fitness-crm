import { afterEach, describe, expect, it } from "vitest";
import { DATA_SCOPE_RESOURCES } from "@gymcrm/shared/permissions";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { prisma } from "../../src/platform/db/prisma.js";
import {
  canApproveDiscount,
  createPromotion,
  listPromotions,
  quotePrice,
  updatePromotion,
} from "../../src/modules/promotions/promotion.service.js";
import { createService, saveTiers } from "../../src/modules/services/service.service.js";
import { cloneRole, createRole, updateRole } from "../../src/platform/roles/role.service.js";
import { resetDatabase } from "../support/database.js";
import { DEFAULT_BRANCH_ID, createTestUser } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

const today = calendarDateInTimeZone("Asia/Ho_Chi_Minh");
const day = (offset: number) => {
  const date = new Date(today.getTime() + offset * 86_400_000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getUTCDate())}/${two(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
};

async function admin() {
  return (await createTestUser("ADMIN", { allBranches: true })).actor;
}

/** A service with one tier: 1 to 100 sessions at 1,000,000 each. */
async function priced(actor: Awaited<ReturnType<typeof admin>>, name = "Hybrid Training") {
  const service = await createService(actor, { name, kind: "PT", branchIds: [DEFAULT_BRANCH_ID] });
  await saveTiers(actor, service.id, {
    effectiveFrom: day(-30),
    tiers: [{ minSessions: 1, maxSessions: 100, unitPrice: 1_000_000, validityMonths: 3, validityDays: 0 }],
  });
  return service;
}

const promotion = (overrides: Record<string, unknown> = {}) => ({
  kind: "PROMOTION",
  name: "Tết",
  discountType: "PERCENT",
  value: "10",
  ...overrides,
});
const voucher = (overrides: Record<string, unknown> = {}) =>
  promotion({ kind: "VOUCHER", name: "Bạn mới", code: "BAN-MOI", ...overrides });

describe("promotions and vouchers (FR-SVC-004, BR-303)", () => {
  it("creates a promotion and a voucher and writes the audit events", async () => {
    const actor = await admin();
    const service = await priced(actor);

    const created = await createPromotion(
      actor,
      promotion({ serviceIds: [service.id], validFrom: day(0), validTo: day(30) }),
    );
    const code = await createPromotion(actor, voucher({ discountType: "AMOUNT", value: "500.000" }));

    expect(created).toMatchObject({
      kind: "PROMOTION",
      name: "Tết",
      code: null,
      discountType: "PERCENT",
      value: 10,
      active: true,
    });
    expect(created.services.map((s) => s.id)).toEqual([service.id]);
    expect(code).toMatchObject({
      kind: "VOUCHER",
      code: "BAN-MOI",
      discountType: "AMOUNT",
      value: 500_000,
      services: [],
    });
    expect(await prisma.auditEvent.count({ where: { action: "promotion.created" } })).toBe(2);
  });

  it("keeps voucher codes unique, and its kind and code fixed once made", async () => {
    const actor = await admin();
    const made = await createPromotion(actor, voucher());

    await expect(createPromotion(actor, voucher({ name: "Khác", code: "ban-moi" }))).rejects.toMatchObject({
      fieldErrors: { code: ["codeTaken"] },
    });
    await expect(updatePromotion(actor, made.id, voucher({ code: "KHAC-1" }))).rejects.toMatchObject({
      fieldErrors: { code: ["invalidChoice"] },
    });
    await expect(updatePromotion(actor, made.id, promotion())).rejects.toMatchObject({
      fieldErrors: { kind: ["invalidChoice"] },
    });
    await expect(
      createPromotion(actor, promotion({ serviceIds: ["a0000000-0000-4000-8000-000000000009"] })),
    ).rejects.toMatchObject({
      fieldErrors: { serviceIds: ["invalidChoice"] },
    });
  });

  it("updates every field and audits only what changed", async () => {
    const actor = await admin();
    const made = await createPromotion(actor, promotion());

    const updated = await updatePromotion(actor, made.id, promotion({ value: "15", active: false }));

    expect(updated).toMatchObject({ value: 15, active: false });
    const events = await prisma.auditEvent.findMany({ where: { entityId: made.id }, orderBy: { createdAt: "asc" } });
    expect(events[1]).toMatchObject({
      action: "promotion.updated",
      before: { value: 10, active: true },
      after: { value: 15, active: false },
    });
  });

  it("shows staff only the promotions on offer today, with no vouchers and no codes; Admin sees all", async () => {
    const actor = await admin();
    await createPromotion(actor, promotion({ name: "Đang chạy" }));
    await createPromotion(actor, promotion({ name: "Sắp tới", validFrom: day(5) }));
    await createPromotion(actor, promotion({ name: "Hết hạn", validTo: day(-1) }));
    await createPromotion(actor, promotion({ name: "Tắt", active: false }));
    await createPromotion(actor, voucher());
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    expect((await listPromotions(reception, {})).map((p) => p.name)).toEqual(["Đang chạy"]);
    expect((await listPromotions(reception, { kind: "VOUCHER" })).length).toBe(0);
    const all = await listPromotions(actor, {});
    expect(all.map((p) => p.name).sort()).toEqual(["Bạn mới", "Hết hạn", "Sắp tới", "Tắt", "Đang chạy"]);
    expect(all.find((p) => p.kind === "VOUCHER")?.code).toBe("BAN-MOI");
    expect((await listPromotions(actor, { onOffer: "true" })).map((p) => p.name).sort()).toEqual([
      "Bạn mới",
      "Đang chạy",
    ]);
  });

  it("is managed by Admin only", async () => {
    const actor = await admin();
    const made = await createPromotion(actor, promotion());
    for (const role of ["FITNESS_MANAGER", "CONSULTING", "RECEPTIONIST"] as const) {
      const { actor: user } = await createTestUser(role);
      await expect(createPromotion(user, promotion({ name: `X ${role}` }))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(updatePromotion(user, made.id, promotion())).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const { actor: trainer } = await createTestUser("PT");
    await expect(listPromotions(trainer, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the quote (A-110, A-111)", () => {
  it("is the tier price with nothing chosen", async () => {
    const actor = await admin();
    const service = await priced(actor);

    expect(await quotePrice(actor, service.id, { sessions: "10" })).toMatchObject({
      unitPrice: 1_000_000,
      promotion: null,
      voucher: null,
      discountPercent: 0,
      breakdown: { gross: 10_000_000, totalDiscount: 0, net: 10_000_000, vatAmount: 0, total: 10_000_000 },
    });
  });

  it("takes the promotion off first, the voucher off what is left, and adds VAT on the discounted price", async () => {
    const actor = await admin();
    const service = await priced(actor);
    const promo = await createPromotion(actor, promotion());
    await createPromotion(actor, voucher());

    const quote = await quotePrice(actor, service.id, {
      sessions: "10",
      promotionId: promo.id,
      voucherCode: "ban-moi",
      vatPercent: "8",
    });

    expect(quote.promotion).toEqual({ id: promo.id, name: "Tết" });
    expect(quote.voucher).toMatchObject({ name: "Bạn mới" });
    expect(quote.breakdown).toEqual({
      gross: 10_000_000,
      promotionDiscount: 1_000_000,
      voucherDiscount: 900_000,
      totalDiscount: 1_900_000,
      net: 8_100_000,
      vatPercent: 8,
      vatAmount: 648_000,
      total: 8_748_000,
    });
    expect(quote.discountPercent).toBe(19);
  });

  it("takes an amount voucher and never goes below zero", async () => {
    const actor = await admin();
    const service = await priced(actor);
    await createPromotion(actor, voucher({ discountType: "AMOUNT", value: "99.000.000", code: "BIG" }));

    const quote = await quotePrice(actor, service.id, { sessions: "1", voucherCode: "BIG" });

    expect(quote.breakdown).toMatchObject({ voucherDiscount: 1_000_000, net: 0, total: 0 });
  });

  it("refuses a promotion or voucher that is off, out of date, for another service, or unknown (never ignores it)", async () => {
    const actor = await admin();
    const service = await priced(actor);
    const other = await priced(actor, "Group");
    const forOther = await createPromotion(actor, promotion({ name: "Riêng", serviceIds: [other.id] }));
    const off = await createPromotion(actor, promotion({ name: "Tắt", active: false }));
    const late = await createPromotion(actor, promotion({ name: "Muộn", validFrom: day(3) }));
    const expired = await createPromotion(actor, voucher({ code: "OLD", validTo: day(-1) }));

    for (const bad of [forOther, off, late]) {
      await expect(quotePrice(actor, service.id, { sessions: "5", promotionId: bad.id })).rejects.toMatchObject({
        fieldErrors: { promotionId: ["promotionNotValid"] },
      });
    }
    await expect(quotePrice(actor, service.id, { sessions: "5", voucherCode: "OLD" })).rejects.toMatchObject({
      fieldErrors: { voucherCode: ["voucherNotValid"] },
    });
    await expect(quotePrice(actor, service.id, { sessions: "5", voucherCode: "NOPE" })).rejects.toMatchObject({
      fieldErrors: { voucherCode: ["voucherNotValid"] },
    });
    // A voucher is not a promotion, whatever the id.
    await expect(quotePrice(actor, service.id, { sessions: "5", promotionId: expired.id })).rejects.toMatchObject({
      fieldErrors: { promotionId: ["promotionNotValid"] },
    });
    // On the day it is valid, the same promotion is accepted.
    expect(await quotePrice(actor, service.id, { sessions: "5", promotionId: late.id, asOf: day(3) })).toMatchObject({
      breakdown: { promotionDiscount: 500_000 },
    });
  });

  it("keeps the tier lookup's refusals: a count no tier covers", async () => {
    const actor = await admin();
    const service = await priced(actor);

    await expect(quotePrice(actor, service.id, { sessions: "101" })).rejects.toMatchObject({
      fieldErrors: { sessions: ["noPriceTier"] },
    });
    await expect(quotePrice(actor, service.id, { sessions: "5", vatPercent: "101" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("the discount a role may approve (FR-PLT-002, A-112)", () => {
  it("starts at Admin any, the Fitness Manager 10%, and nobody else any", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: boss } = await createTestUser("ADMIN");
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    expect(await canApproveDiscount(prisma, manager, 10)).toBe(true);
    expect(await canApproveDiscount(prisma, manager, 10.01)).toBe(false);
    expect(await canApproveDiscount(prisma, boss, 100)).toBe(true);
    expect(await canApproveDiscount(prisma, reception, 0)).toBe(true);
    expect(await canApproveDiscount(prisma, reception, 0.01)).toBe(false);
  });

  it("is set on a role, kept by a clone, and audited when it changes", async () => {
    const actor = await admin();
    const input = {
      name: "Trưởng nhóm",
      permissions: ["customer.view"],
      dataScopes: Object.fromEntries(DATA_SCOPE_RESOURCES.map((resource) => [resource, "OWN"])),
      fieldMasks: [],
      discountThresholdPct: "7,5",
    };

    const role = await createRole(actor, { ...input, discountThresholdPct: "7.5" });
    expect(role.discountThresholdPct).toBe(7.5);
    const clone = await cloneRole(actor, role.id, { name: "Bản sao" });
    expect(clone.discountThresholdPct).toBe(7.5);

    const changed = await updateRole(actor, role.id, { ...input, discountThresholdPct: "12" });
    expect(changed.discountThresholdPct).toBe(12);
    const event = await prisma.auditEvent.findFirst({ where: { entityId: role.id, action: "role.updated" } });
    expect(event).toMatchObject({ before: { discountThresholdPct: 7.5 }, after: { discountThresholdPct: 12 } });
    await expect(updateRole(actor, role.id, { ...input, discountThresholdPct: "101" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
