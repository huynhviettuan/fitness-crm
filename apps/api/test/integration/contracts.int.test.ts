import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Actor } from "../../src/platform/auth/session.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import {
  activateContract,
  cancelContract,
  createContract,
  getContract,
  listContracts,
  updateContract,
} from "../../src/modules/contracts/contract.service.js";
import { createEmployee, updateEmployee } from "../../src/modules/employees/employee.service.js";
import { createPromotion } from "../../src/modules/promotions/promotion.service.js";
import { createService, saveTiers } from "../../src/modules/services/service.service.js";
import { checkIn, completeSession } from "../../src/modules/sessions/session.service.js";
import { resetDatabase } from "../support/database.js";
import { DEFAULT_BRANCH_ID, createTestBranch, createTestUser, optionId } from "../support/factories.js";
import {
  activeContract,
  book,
  bookingScenario,
  contractInput,
  createTrainer,
  testSalesperson,
  testService,
} from "../support/bookings.js";

afterEach(async () => {
  vi.useRealTimers();
  await resetDatabase();
});

/** A Fitness Manager who sells, and another who approves: nobody approves their own (D-018). */
async function setup() {
  const { actor: seller } = await createTestUser("FITNESS_MANAGER");
  const { actor: approver } = await createTestUser("FITNESS_MANAGER");
  const customer = await createCustomer(seller, { fullName: "Nguyễn Văn An", phone: "0909123456" });
  return { seller, approver, customer };
}

async function create(actor: Actor, customerId: string, overrides: Record<string, unknown> = {}, key = randomUUID()) {
  return createContract(actor, customerId, await contractInput(overrides), key);
}

const admin = async () => (await createTestUser("ADMIN", { allBranches: true })).actor;

describe("createContract", () => {
  it("creates a DRAFT with a generated code, a price from the tier, derived figures, and an audit event", async () => {
    const { seller, customer } = await setup();

    const { contract, replayed } = await create(seller, customer.id);

    expect(replayed).toBe(false);
    expect(contract).toMatchObject({
      contractCode: expect.stringMatching(/^HD\d{6,}$/),
      status: "DRAFT",
      customer: { id: customer.id, customerCode: customer.customerCode },
      packageName: "PT 24 buổi",
      service: { name: "PT", kind: "MEMBER" },
      contractType: "NEW",
      sessionsBought: 24,
      totalSessions: 24,
      completedSessions: 0,
      remainingSessions: 24,
      tierUnitPrice: 500_000,
      approvedUnitPrice: 500_000,
      isExceptionPrice: false,
      contractValue: 12_000_000,
      vatAmount: 0,
      discountPercent: 0,
      paidAmount: 0,
      debt: 12_000_000,
      isImported: false,
    });
    // The start day counts: 60 months from 1 October 2026 end on 30 September 2031 (A-108).
    expect(contract.endDate).toEqual(new Date("2031-09-30T00:00:00.000Z"));
    const audit = await prisma.auditEvent.findMany({ where: { entityId: contract.id } });
    expect(audit).toEqual([expect.objectContaining({ action: "contract.created", actorUserId: seller.id })]);
  });

  it("gives contracts created at the same time different codes (T-019)", async () => {
    const { seller, customer } = await setup();
    await contractInput();

    const results = await Promise.all(Array.from({ length: 8 }, () => create(seller, customer.id)));

    expect(new Set(results.map((r) => r.contract.contractCode)).size).toBe(8);
  });

  it.each(["PT", "ACCOUNTANT"] as const)("refuses a %s (docs/09)", async (role) => {
    const { customer } = await setup();
    const { actor } = await createTestUser(role);

    await expect(create(actor, customer.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an unknown customer", async () => {
    const { seller } = await setup();

    await expect(create(seller, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns field errors and saves nothing for invalid input", async () => {
    const { seller, customer } = await setup();

    await expect(create(seller, customer.id, { sessions: "0", vatPercent: "101" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { sessions: ["invalidNumber"], vatPercent: ["invalidPercent"] },
    });
    expect(await prisma.contract.count()).toBe(0);
  });

  it("does not take a price, a total, an end date, a name, or a status from the client (BR-301)", async () => {
    const { seller, customer } = await setup();

    const { contract } = await create(seller, customer.id, {
      unitPrice: 1,
      contractValue: 1,
      totalSessions: 1,
      endDate: "01/01/2026",
      packageName: "Hack",
      status: "ACTIVE",
    });

    expect(contract).toMatchObject({ contractValue: 12_000_000, packageName: "PT 24 buổi", status: "DRAFT" });
  });
});

describe("the price comes from the tier (BR-301, AC-10)", () => {
  async function tiered() {
    const { seller, approver, customer } = await setup();
    const boss = await admin();
    const service = await createService(boss, {
      name: "Hybrid Training",
      kind: "MEMBER",
      branchIds: [DEFAULT_BRANCH_ID],
    });
    await saveTiers(boss, service.id, {
      effectiveFrom: "01/01/2020",
      tiers: [
        { minSessions: 1, maxSessions: 11, unitPrice: 700_000, validityMonths: 1, validityDays: 0 },
        { minSessions: 12, maxSessions: 23, unitPrice: 650_000, validityMonths: 2, validityDays: 10 },
      ],
    });
    return { seller, approver, customer, boss, service };
  }

  it("takes any count in a tier: unit price, total, name, and end date follow the tier", async () => {
    const { seller, customer, service } = await tiered();

    const { contract } = await create(seller, customer.id, { serviceId: service.id, sessions: 12 });

    expect(contract).toMatchObject({
      packageName: "Hybrid Training 12 buổi",
      tierUnitPrice: 650_000,
      contractValue: 7_800_000,
    });
    // 2 months and 10 days from 1 October, the start day counting: 10 December.
    expect(contract.endDate).toEqual(new Date("2026-12-10T00:00:00.000Z"));
  });

  it("refuses a count no tier covers, and never rounds to a nearby tier (A-107)", async () => {
    const { seller, customer, service } = await tiered();

    await expect(create(seller, customer.id, { serviceId: service.id, sessions: 30 })).rejects.toMatchObject({
      fieldErrors: { sessions: ["noPriceTier"] },
    });
    expect(await prisma.contract.count()).toBe(0);
  });

  it("prices at the contract date, so an older contract keeps the price it was signed at", async () => {
    const { seller, customer, boss, service } = await tiered();
    await saveTiers(boss, service.id, {
      effectiveFrom: "01/01/2027",
      tiers: [{ minSessions: 1, maxSessions: 100, unitPrice: 900_000, validityMonths: 1, validityDays: 0 }],
    });

    const before = await create(seller, customer.id, {
      serviceId: service.id,
      sessions: 5,
      contractDate: "31/12/2026",
    });
    const after = await create(seller, customer.id, {
      serviceId: service.id,
      sessions: 5,
      contractDate: "01/01/2027",
      startDate: "01/01/2027",
    });

    expect(before.contract.tierUnitPrice).toBe(700_000);
    expect(after.contract.tierUnitPrice).toBe(900_000);
  });

  it("refuses a service that is off, outside its validity, or not sold in the customer's branch", async () => {
    const { seller, customer, boss, service } = await tiered();
    const elsewhere = await createTestBranch();
    const abroad = await createService(boss, { name: "Xa", kind: "MEMBER", branchIds: [elsewhere.id] });
    await saveTiers(boss, abroad.id, {
      effectiveFrom: "01/01/2020",
      tiers: [{ minSessions: 1, maxSessions: 100, unitPrice: 1, validityMonths: 1, validityDays: 0 }],
    });

    await expect(create(seller, customer.id, { serviceId: abroad.id })).rejects.toMatchObject({
      fieldErrors: { serviceId: ["invalidChoice"] },
    });
    await prisma.service.update({ where: { id: service.id }, data: { active: false } });
    await expect(create(seller, customer.id, { serviceId: service.id, sessions: 5 })).rejects.toMatchObject({
      fieldErrors: { serviceId: ["serviceNotOnSale"] },
    });
    await expect(create(seller, customer.id, { serviceId: randomUUID() })).rejects.toMatchObject({
      fieldErrors: { serviceId: ["invalidChoice"] },
    });
  });

  it("takes a promotion, then a voucher on what is left, then VAT (A-110, A-111)", async () => {
    const { seller, customer, boss } = await tiered();
    const promo = await createPromotion(boss, { kind: "PROMOTION", name: "Tết", discountType: "PERCENT", value: "10" });
    await createPromotion(boss, {
      kind: "VOUCHER",
      name: "Bạn mới",
      code: "BAN-MOI",
      discountType: "PERCENT",
      value: "10",
    });

    const { contract } = await create(seller, customer.id, {
      sessions: 24,
      promotionId: promo.id,
      voucherCode: "ban-moi",
      vatPercent: "8",
    });

    // 24 x 500,000 = 12,000,000; 10% = 1,200,000; 10% of the rest = 1,080,000; VAT 8% of 9,720,000 = 777,600.
    expect(contract).toMatchObject({
      promotion: { name: "Tết" },
      voucher: { name: "Bạn mới" },
      promotionDiscount: 1_200_000,
      voucherDiscount: 1_080_000,
      vatPercent: 8,
      vatAmount: 777_600,
      contractValue: 10_497_600,
      isExceptionPrice: false,
      discountPercent: 19,
    });
  });

  it("refuses a promotion or voucher that cannot be used instead of ignoring it", async () => {
    const { seller, customer, boss } = await tiered();
    const off = await createPromotion(boss, {
      kind: "PROMOTION",
      name: "Hết hạn",
      discountType: "PERCENT",
      value: "10",
      validTo: "01/01/2020",
    });

    await expect(create(seller, customer.id, { promotionId: off.id })).rejects.toMatchObject({
      fieldErrors: { promotionId: ["promotionNotValid"] },
    });
    await expect(create(seller, customer.id, { voucherCode: "NOPE" })).rejects.toMatchObject({
      fieldErrors: { voucherCode: ["voucherNotValid"] },
    });
  });
});

describe("an exception price (BR-302, A-113)", () => {
  it("takes an agreed price with a reason, keeps both prices, and flags the contract", async () => {
    const { seller, customer } = await setup();
    const reason = await optionId("exceptionPriceReasons", "Khác");

    const { contract } = await create(seller, customer.id, {
      proposedUnitPrice: "400.000",
      exceptionReasonId: reason,
      exceptionNote: "Khách thân thiết",
    });

    expect(contract).toMatchObject({
      isExceptionPrice: true,
      tierUnitPrice: 500_000,
      approvedUnitPrice: 400_000,
      contractValue: 9_600_000,
      exceptionReason: { labelVi: "Khác", note: "Khách thân thiết" },
      discountPercent: 20,
    });
  });

  it("needs a reason, a note with Khác, and refuses a promotion beside it", async () => {
    const { seller, customer } = await setup();
    const reason = await optionId("exceptionPriceReasons", "Khác");
    const promo = await createPromotion(await admin(), {
      kind: "PROMOTION",
      name: "Tết",
      discountType: "PERCENT",
      value: "10",
    });

    await expect(create(seller, customer.id, { proposedUnitPrice: "400000" })).rejects.toMatchObject({
      fieldErrors: { exceptionReasonId: ["required"] },
    });
    await expect(
      create(seller, customer.id, { proposedUnitPrice: "400000", exceptionReasonId: reason }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      create(seller, customer.id, {
        proposedUnitPrice: "400000",
        exceptionReasonId: reason,
        exceptionNote: "x",
        promotionId: promo.id,
      }),
    ).rejects.toMatchObject({ fieldErrors: { proposedUnitPrice: ["exceptionExcludesPromotion"] } });
  });

  it("is not an exception when the agreed price is the tier's", async () => {
    const { seller, customer } = await setup();
    const reason = await optionId("exceptionPriceReasons", "Khác");

    const { contract } = await create(seller, customer.id, {
      proposedUnitPrice: "500000",
      exceptionReasonId: reason,
      exceptionNote: "x",
    });

    expect(contract).toMatchObject({ isExceptionPrice: false, exceptionReason: null });
  });
});

describe("bonus, dates, and renewal", () => {
  it("keeps the bonus apart: entitled sessions add up and the end date moves", async () => {
    const { seller, customer } = await setup();

    const { contract } = await create(seller, customer.id, { bonusSessions: 2, bonusMonths: 1, bonusDays: 5 });

    expect(contract).toMatchObject({
      sessionsBought: 24,
      bonusSessions: 2,
      totalSessions: 26,
      remainingSessions: 26,
      contractValue: 12_000_000,
    });
    // 61 months and 5 days from 1 October 2026, the start day counting.
    expect(contract.endDate).toEqual(new Date("2031-11-05T00:00:00.000Z"));
  });

  it("starts on the contract date when no start day is given, and checks the activation deadline", async () => {
    const { seller, customer } = await setup();

    const { contract } = await create(seller, customer.id, { startDate: "", activationDeadline: "15/10/2026" });
    expect(contract.startDate).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    expect(contract.activationDeadline).toEqual(new Date("2026-10-15T00:00:00.000Z"));
    await expect(create(seller, customer.id, { activationDeadline: "01/09/2026" })).rejects.toMatchObject({
      fieldErrors: { activationDeadline: ["deadlineBeforeStart"] },
    });
  });

  it("links a renewal to the customer's earlier contract, and refuses anyone else's", async () => {
    const { seller, customer } = await setup();
    const first = await create(seller, customer.id);
    const stranger = await createCustomer(seller, { fullName: "Lê Thị Hoa", phone: "0388777666" });
    const theirs = await create(seller, stranger.id);

    const renewal = await create(seller, customer.id, { contractType: "RENEW", previousContractId: first.contract.id });

    expect(renewal.contract).toMatchObject({
      contractType: "RENEW",
      previousContract: { id: first.contract.id, contractCode: first.contract.contractCode },
    });
    await expect(
      create(seller, customer.id, { contractType: "RENEW", previousContractId: theirs.contract.id }),
    ).rejects.toMatchObject({ fieldErrors: { previousContractId: ["invalidChoice"] } });
    await expect(
      create(seller, customer.id, { contractType: "NEW", previousContractId: first.contract.id }),
    ).rejects.toMatchObject({ fieldErrors: { previousContractId: ["newHasNoPrevious"] } });
  });
});

describe("PT and Sale shares (A-115)", () => {
  it("needs a salesperson and 100 percent in total, and names an employee once", async () => {
    const { seller, customer } = await setup();
    const sale = await testSalesperson();
    const other = await createEmployee(seller, { fullName: "Nhân viên hai" });

    await expect(create(seller, customer.id, { saleShares: [] })).rejects.toMatchObject({
      fieldErrors: { saleShares: ["sharesRequired"] },
    });
    await expect(
      create(seller, customer.id, { saleShares: [{ employeeId: sale.id, percent: 60 }] }),
    ).rejects.toMatchObject({ fieldErrors: { saleShares: ["sharesTotal"] } });
    await expect(
      create(seller, customer.id, {
        saleShares: [
          { employeeId: sale.id, percent: 50 },
          { employeeId: sale.id, percent: 50 },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const { contract } = await create(seller, customer.id, {
      saleShares: [
        { employeeId: sale.id, percent: 33.33 },
        { employeeId: other.id, percent: 66.67 },
      ],
    });
    expect(contract.shares.map((s) => [s.role, s.percent]).sort()).toEqual([
      ["SALE", 33.33],
      ["SALE", 66.67],
    ]);
  });

  it("needs trainers for a PT service, and refuses PT shares on another kind", async () => {
    const { seller, customer } = await setup();
    const boss = await admin();
    const sale = await testSalesperson();
    const trainer = await createTrainer(boss, { fullName: "PT Minh" });
    const service = await createService(boss, { name: "PT 1-1", kind: "PT", branchIds: [DEFAULT_BRANCH_ID] });
    await saveTiers(boss, service.id, {
      effectiveFrom: "01/01/2020",
      tiers: [{ minSessions: 1, maxSessions: 100, unitPrice: 800_000, validityMonths: 3, validityDays: 0 }],
    });
    const base = { serviceId: service.id, sessions: 10 };

    await expect(create(seller, customer.id, base)).rejects.toMatchObject({
      fieldErrors: { ptShares: ["sharesRequired"] },
    });
    await expect(
      create(seller, customer.id, { ...base, ptShares: [{ employeeId: sale.id, percent: 100 }] }),
    ).rejects.toMatchObject({ fieldErrors: { ptShares: ["invalidChoice"] } });
    const { contract } = await create(seller, customer.id, {
      ...base,
      ptShares: [{ employeeId: trainer.id, percent: 100 }],
    });
    expect(contract.shares.find((s) => s.role === "PT")?.employee.fullName).toBe("PT Minh");
    await expect(
      create(seller, customer.id, { ptShares: [{ employeeId: trainer.id, percent: 100 }] }),
    ).rejects.toMatchObject({ fieldErrors: { ptShares: ["ptSharesNotAllowed"] } });
  });

  it("names only active staff of the contract's branch", async () => {
    const { seller, customer } = await setup();
    const elsewhere = await createTestBranch();
    const boss = await admin();
    const abroad = await createEmployee(boss, { fullName: "Ở chi nhánh khác", branchId: elsewhere.id });
    const left = await createEmployee(boss, { fullName: "Đã nghỉ", branchId: DEFAULT_BRANCH_ID });
    await updateEmployee(boss, left.id, { fullName: "Đã nghỉ", status: "INACTIVE" });

    for (const employee of [abroad, left]) {
      await expect(
        create(seller, customer.id, { saleShares: [{ employeeId: employee.id, percent: 100 }] }),
      ).rejects.toMatchObject({ fieldErrors: { saleShares: ["invalidChoice"] } });
    }
  });
});

describe("companions of a group package (A-116)", () => {
  async function group() {
    const { seller, customer } = await setup();
    const boss = await admin();
    const service = await createService(boss, {
      name: "Hybrid Family",
      kind: "MEMBER",
      branchIds: [DEFAULT_BRANCH_ID],
      isGroup: true,
      maxMembers: 3,
    });
    await saveTiers(boss, service.id, {
      effectiveFrom: "01/01/2020",
      tiers: [{ minSessions: 1, maxSessions: 100, unitPrice: 600_000, validityMonths: 3, validityDays: 0 }],
    });
    const members = [];
    for (const [name, phone] of [
      ["Lê Thị Hoa", "0388777666"],
      ["Trần Văn Bình", "0377666555"],
      ["Phạm Thu Hà", "0366555444"],
    ]) {
      members.push(await createCustomer(seller, { fullName: name, phone }));
    }
    return { seller, customer, service, members };
  }

  it("lists the other members, up to the service's limit", async () => {
    const { seller, customer, service, members } = await group();

    const { contract } = await create(seller, customer.id, {
      serviceId: service.id,
      companionIds: [members[0].id, members[1].id],
    });

    expect(contract.companions.map((c) => c.fullName).sort()).toEqual(["Lê Thị Hoa", "Trần Văn Bình"]);
    await expect(
      create(seller, customer.id, { serviceId: service.id, companionIds: members.map((m) => m.id) }),
    ).rejects.toMatchObject({ fieldErrors: { companionIds: ["tooManyCompanions"] } });
    await expect(
      create(seller, customer.id, { serviceId: service.id, companionIds: [customer.id] }),
    ).rejects.toMatchObject({ fieldErrors: { companionIds: ["invalidChoice"] } });
  });

  it("is only for group services", async () => {
    const { seller, customer, members } = await group();

    await expect(create(seller, customer.id, { companionIds: [members[0].id] })).rejects.toMatchObject({
      fieldErrors: { companionIds: ["companionsNotAllowed"] },
    });
  });
});

describe("the first payment (A-119)", () => {
  it("is saved with the contract as a receipt, and a replay does not repeat it", async () => {
    const { seller, customer } = await setup();
    const method = await optionId("paymentMethods", "Tiền mặt");
    const key = randomUUID();
    const input = await contractInput({ firstPayment: { amount: "3.000.000", methodId: method } });

    const first = await createContract(seller, customer.id, input, key);
    const again = await createContract(seller, customer.id, input, key);

    expect(again.replayed).toBe(true);
    const payments = await prisma.payment.findMany({ where: { contractId: first.contract.id } });
    expect(payments).toHaveLength(1);
    expect(Number(payments[0]!.amount)).toBe(3_000_000);
  });

  it("is all or nothing: a payment above the value saves no contract", async () => {
    const { seller, customer } = await setup();
    const method = await optionId("paymentMethods", "Tiền mặt");

    await expect(
      create(seller, customer.id, { firstPayment: { amount: "99.000.000", methodId: method } }),
    ).rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_CONTRACT_VALUE" });
    expect(await prisma.contract.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("needs the permission to record payments", async () => {
    const { customer } = await setup();
    const { actor: consultant } = await createTestUser("CONSULTING");
    await prisma.userPermissionOverride.create({
      data: { userId: consultant.id, permission: "payment.record", granted: false },
    });
    const method = await optionId("paymentMethods", "Tiền mặt");
    const mine = await createCustomer(consultant, { fullName: "Của tôi", phone: "0355444333" });

    await expect(
      createContract(
        await refreshed(consultant),
        mine.id,
        await contractInput({ firstPayment: { amount: "1000000", methodId: method } }),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(customer.id).toBeDefined();
  });
});

async function refreshed(actor: Actor): Promise<Actor> {
  const { actorOf } = await import("../support/factories.js");
  return actorOf(actor.id);
}

describe("duplicate submission (T-015)", () => {
  it("requires an idempotency key", async () => {
    const { seller, customer } = await setup();
    const input = await contractInput();

    for (const key of [undefined, "", "not-a-uuid"]) {
      await expect(createContract(seller, customer.id, input, key)).rejects.toMatchObject({
        code: "IDEMPOTENCY_KEY_REQUIRED",
      });
    }
  });

  it("a replay with the same key returns the original and creates nothing new", async () => {
    const { seller, customer } = await setup();
    const key = randomUUID();
    const input = await contractInput();

    const first = await createContract(seller, customer.id, input, key);
    const second = await createContract(seller, customer.id, input, key);

    expect(second).toEqual({ contract: first.contract, replayed: true });
    expect(await prisma.contract.count()).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "contract.created" } })).toBe(1);
  });

  it("the same key with different content is refused", async () => {
    const { seller, customer } = await setup();
    const key = randomUUID();
    await create(seller, customer.id, {}, key);

    await expect(create(seller, customer.id, { sessions: 12 }, key)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("a double-click (same key sent at the same time) creates one contract", async () => {
    const { seller, customer } = await setup();
    const key = randomUUID();
    const input = await contractInput();

    const results = await Promise.all(Array.from({ length: 5 }, () => createContract(seller, customer.id, input, key)));

    expect(new Set(results.map((r) => r.contract.id)).size).toBe(1);
    expect(await prisma.contract.count()).toBe(1);
  });
});

describe("status changes", () => {
  it("activates a draft once, and a repeat changes nothing", async () => {
    const { seller, approver, customer } = await setup();
    const { contract } = await create(seller, customer.id);

    expect((await activateContract(approver, contract.id)).status).toBe("ACTIVE");
    expect((await activateContract(approver, contract.id)).status).toBe("ACTIVE");

    expect(await prisma.auditEvent.count({ where: { entityId: contract.id, action: "contract.activated" } })).toBe(1);
  });

  it("is never approved by the contract's creator (D-018)", async () => {
    const { seller, customer } = await setup();
    const { contract } = await create(seller, customer.id);

    await expect(activateContract(seller, contract.id)).rejects.toMatchObject({ code: "APPROVAL_OWN_REQUEST" });
    expect((await getContract(seller, contract.id)).status).toBe("DRAFT");
  });

  it("is refused to an approver whose role may not approve that big a discount, and allowed to a higher one (A-112)", async () => {
    const { seller, approver, customer } = await setup();
    const boss = await admin();
    const small = await createPromotion(boss, { kind: "PROMOTION", name: "Nhỏ", discountType: "PERCENT", value: "10" });
    const big = await createPromotion(boss, { kind: "PROMOTION", name: "Lớn", discountType: "PERCENT", value: "20" });
    const ten = await create(seller, customer.id, { promotionId: small.id });
    const twenty = await create(seller, customer.id, { promotionId: big.id });

    // The Fitness Manager's limit is 10% of the tier price.
    expect((await activateContract(approver, ten.contract.id)).status).toBe("ACTIVE");
    await expect(activateContract(approver, twenty.contract.id)).rejects.toMatchObject({
      code: "DISCOUNT_ABOVE_LIMIT",
    });
    expect((await getContract(seller, twenty.contract.id)).status).toBe("DRAFT");
    expect((await activateContract(boss, twenty.contract.id)).status).toBe("ACTIVE");
  });

  it("concurrent activations record exactly one transition", async () => {
    const { seller, approver, customer } = await setup();
    const { contract } = await create(seller, customer.id);

    await Promise.all(Array.from({ length: 5 }, () => activateContract(approver, contract.id)));

    expect(await prisma.auditEvent.count({ where: { entityId: contract.id, action: "contract.activated" } })).toBe(1);
  });

  it("a receptionist cannot cancel; a Fitness Manager can (09_RBAC.md)", async () => {
    const { seller, approver, customer } = await setup();
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { contract } = await create(seller, customer.id);
    await activateContract(approver, contract.id);

    await expect(cancelContract(reception, contract.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await cancelContract(manager, contract.id)).status).toBe("CANCELLED");
    expect((await cancelContract(manager, contract.id)).status).toBe("CANCELLED");
    await expect(activateContract(approver, contract.id)).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });

  it("an expired contract cannot be cancelled", async () => {
    const { seller, approver, customer } = await setup();
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { contract } = await createContract(
      seller,
      customer.id,
      await contractInput({ contractDate: "01/01/2025", startDate: "01/01/2025" }, { months: 1 }),
      randomUUID(),
    );
    expect((await activateContract(approver, contract.id)).status).toBe("EXPIRED");

    await expect(cancelContract(manager, contract.id)).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });
});

describe("editing (OQ-015 interim: drafts only)", () => {
  it("a draft can be edited, the price is worked out again, and the change is audited", async () => {
    const { seller, customer } = await setup();
    const { contract } = await create(seller, customer.id);

    const updated = await updateContract(seller, contract.id, await contractInput({ sessions: 12 }));

    expect(updated).toMatchObject({
      sessionsBought: 12,
      totalSessions: 12,
      contractValue: 6_000_000,
      packageName: "PT 12 buổi",
      contractCode: contract.contractCode,
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: contract.id, action: "contract.updated" },
    });
    expect(audit).toMatchObject({
      before: { contractValue: "12000000", totalSessions: 24 },
      after: { contractValue: "6000000", totalSessions: 12 },
    });
  });

  it("replaces the shares and refuses a first payment on an edit", async () => {
    const { seller, customer } = await setup();
    const { contract } = await create(seller, customer.id);
    const other = await createEmployee(seller, { fullName: "Nhân viên hai" });
    const method = await optionId("paymentMethods", "Tiền mặt");

    const updated = await updateContract(
      seller,
      contract.id,
      await contractInput({ saleShares: [{ employeeId: other.id, percent: 100 }] }),
    );
    expect(updated.shares.map((s) => s.employee.fullName)).toEqual(["Nhân viên hai"]);
    await expect(
      updateContract(seller, contract.id, await contractInput({ firstPayment: { amount: "1000", methodId: method } })),
    ).rejects.toMatchObject({ fieldErrors: { firstPayment: ["onlyOnCreate"] } });
  });

  it("an active contract cannot be edited", async () => {
    const { seller, approver, customer } = await setup();
    const { contract } = await create(seller, customer.id);
    await activateContract(approver, contract.id);

    await expect(updateContract(seller, contract.id, await contractInput({ sessions: 48 }))).rejects.toMatchObject({
      code: "CONTRACT_NOT_EDITABLE",
    });
  });
});

describe("reading", () => {
  it("counts opening balances of an imported contract (D-011)", async () => {
    const { seller, customer } = await setup();
    const { contract } = await create(seller, customer.id);
    // Set as the import tool will (OQ-014): directly, once.
    await prisma.contract.update({
      where: { id: contract.id },
      data: { openingSessionsUsed: 8, openingPaidAmount: 5_000_000 },
    });

    expect(await getContract(seller, contract.id)).toMatchObject({
      remainingSessions: 16,
      openingPaidAmount: 5_000_000,
      paidAmount: 5_000_000,
      debt: 7_000_000,
    });
  });

  it("reports EXPIRED from the end date and the gym's clock, with no job (INT-008)", async () => {
    const { seller, approver, customer } = await setup();
    const { contract } = await createContract(
      seller,
      customer.id,
      await contractInput({}, { months: 1 }),
      randomUUID(),
    );
    await activateContract(approver, contract.id);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T16:59:00Z")); // 23:59 on 31/10 in the gym
    expect((await getContract(seller, contract.id)).status).toBe("ACTIVE");
    vi.setSystemTime(new Date("2026-10-31T17:00:00Z")); // 00:00 the next day
    expect((await getContract(seller, contract.id)).status).toBe("EXPIRED");
  });

  it("a trainer sees no contracts until bookings exist (OQ-006 interim)", async () => {
    const { seller, customer } = await setup();
    const { actor: trainer } = await createTestUser("PT");
    const { contract } = await create(seller, customer.id);

    expect((await listContracts(trainer, {})).total).toBe(0);
    await expect(getContract(trainer, contract.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("searches by contract code, package, and customer name without accents", async () => {
    const { seller, customer } = await setup();
    const { contract } = await create(seller, customer.id);
    const other = await createCustomer(seller, { fullName: "Lê Thị Hoa", phone: "0388777666" });
    await createContract(seller, other.id, await contractInput({ sessions: 12 }, { name: "Yoga" }), randomUUID());

    for (const q of [contract.contractCode.toLowerCase(), "pt 24", "nguyen van"]) {
      expect(
        (await listContracts(seller, { q })).items.map((c) => c.id),
        q,
      ).toEqual([contract.id]);
    }
    expect((await listContracts(seller, { q: "yoga 12" })).total).toBe(1);
  });

  it("the database itself refuses impossible contracts", async () => {
    const { seller, customer } = await setup();
    const { contract } = await create(seller, customer.id);

    await expect(prisma.contract.update({ where: { id: contract.id }, data: { totalSessions: 0 } })).rejects.toThrow();
    await expect(
      prisma.contract.update({ where: { id: contract.id }, data: { openingSessionsUsed: 25 } }),
    ).rejects.toThrow();
    await expect(prisma.contract.update({ where: { id: contract.id }, data: { contractValue: -1 } })).rejects.toThrow();
    // A priced contract names its service; only an imported one may not (BR-301).
    await expect(prisma.contract.update({ where: { id: contract.id }, data: { serviceId: null } })).rejects.toThrow();
    // An exception price says why.
    await expect(
      prisma.contract.update({ where: { id: contract.id }, data: { isExceptionPrice: true } }),
    ).rejects.toThrow();
  });
});

describe("cancelling a contract with bookings (D-010, BR-017)", () => {
  it("cancels every BOOKED booking with an audit event each, and leaves finished ones alone", async () => {
    const scenario = await bookingScenario();
    const future = await book(scenario.manager, scenario, { date: "20/10/2026", startTime: "08:00", endTime: "09:00" });
    const past = await book(scenario.manager, scenario, { date: "02/10/2026", startTime: "08:00", endTime: "09:00" });
    const completed = await book(scenario.manager, scenario, {
      date: "03/10/2026",
      startTime: "08:00",
      endTime: "09:00",
    });
    await checkIn(scenario.manager, completed.id);
    await completeSession(scenario.manager, completed.id);

    const cancelled = await cancelContract(scenario.manager, scenario.contract.id);

    expect(cancelled).toMatchObject({ status: "CANCELLED", completedSessions: 1 });
    const statuses = await prisma.booking.findMany({ select: { id: true, status: true } });
    expect(Object.fromEntries(statuses.map((b) => [b.id, b.status]))).toEqual({
      [future.id]: "CANCELLED",
      [past.id]: "CANCELLED",
      [completed.id]: "COMPLETED",
    });
    const audits = await prisma.auditEvent.findMany({ where: { action: "booking.cancelled" } });
    expect(audits.map((a) => a.entityId).sort()).toEqual([future.id, past.id].sort());
    expect(audits[0].metadata).toMatchObject({ reason: "contract.cancelled", contractId: scenario.contract.id });
    // The trainer's time is free again (A-005).
    await expect(createTrainerBooking(scenario, "20/10/2026")).resolves.toBeDefined();
  });

  it("is refused while a booking is checked in, and nothing changes", async () => {
    const scenario = await bookingScenario();
    const checkedIn = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" });
    const booked = await book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" });
    await checkIn(scenario.manager, checkedIn.id);

    await expect(cancelContract(scenario.manager, scenario.contract.id)).rejects.toMatchObject({
      code: "CONTRACT_HAS_CHECKED_IN_BOOKING",
    });
    expect((await getContract(scenario.manager, scenario.contract.id)).status).toBe("ACTIVE");
    expect((await prisma.booking.findUnique({ where: { id: booked.id } }))?.status).toBe("BOOKED");
  });

  it("a check-in racing the cancellation never leaves a checked-in booking on a cancelled contract", async () => {
    for (let round = 0; round < 5; round++) {
      const scenario = await bookingScenario({ phone: `09090000${round}0` });
      const booking = await book(scenario.manager, scenario);

      await Promise.allSettled([
        cancelContract(scenario.manager, scenario.contract.id),
        checkIn(scenario.manager, booking.id),
      ]);

      const contract = await getContract(scenario.manager, scenario.contract.id);
      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      if (contract.status === "CANCELLED") expect(after.status).toBe("CANCELLED");
      else expect(after.status).toBe("CHECKED_IN");
    }
  });
});

describe("the bonus counts when booking (M4.3)", () => {
  it("lets a contract with bonus sessions use them", async () => {
    const scenario = await bookingScenario({ sessions: 1 });
    const bonus = await activeContract(scenario.manager, scenario.customer.id, { sessions: 1, bonusSessions: 1 });
    const next = { ...scenario, contract: bonus };

    await book(scenario.manager, next, { date: "16/10/2026", startTime: "08:00", endTime: "09:00" });
    await book(scenario.manager, next, { date: "17/10/2026", startTime: "08:00", endTime: "09:00" });
    await expect(
      book(scenario.manager, next, { date: "18/10/2026", startTime: "08:00", endTime: "09:00" }),
    ).rejects.toMatchObject({
      code: "CONTRACT_NO_REMAINING_SESSIONS",
    });
    expect(await testService()).toBeDefined();
  });
});

/** Another booking for the scenario's trainer at 08:00–09:00 on `date`, on a new contract. */
async function createTrainerBooking(scenario: Awaited<ReturnType<typeof bookingScenario>>, date: string) {
  const contract = await activeContract(scenario.manager, scenario.customer.id);
  return book(scenario.manager, { ...scenario, contract }, { date, startTime: "08:00", endTime: "09:00" });
}
