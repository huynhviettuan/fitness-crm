import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Actor } from "../../src/platform/auth/session.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import {
  contractHistory,
  createContract,
  getContract,
  listContracts,
  updateContractNote,
} from "../../src/modules/contracts/contract.service.js";
import { activateContract } from "../../src/modules/contracts/contract-approval.service.js";
import { recordPayment } from "../../src/modules/finance/payment.service.js";
import { createPromotion } from "../../src/modules/promotions/promotion.service.js";
import { createService, saveTiers } from "../../src/modules/services/service.service.js";
import { resetDatabase } from "../support/database.js";
import {
  DEFAULT_BRANCH_ID,
  createTestBranch,
  createTestUser,
  optionId,
  withoutApprovals,
} from "../support/factories.js";
import { contractInput, createTrainer } from "../support/bookings.js";

afterEach(resetDatabase);

const CASH = await optionId("paymentMethods", "Tiền mặt");

/** Four contracts of one customer that differ in everything the list filters by (brief §5.3). */
async function scenario() {
  await withoutApprovals();
  const { actor: seller } = await createTestUser("FITNESS_MANAGER");
  const { actor: approver } = await createTestUser("FITNESS_MANAGER");
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  const customer = await createCustomer(seller, { fullName: "Nguyễn Văn An", phone: "0909123456" });
  const trainer = await createTrainer(seller, { fullName: "PT Minh" });

  const ptService = await createService(admin, { name: "PT riêng", kind: "PT", branchIds: [DEFAULT_BRANCH_ID] });
  await saveTiers(admin, ptService.id, {
    effectiveFrom: "01/01/2020",
    tiers: [{ minSessions: 1, maxSessions: 1000, unitPrice: 800_000, validityMonths: 60, validityDays: 0 }],
  });
  const promotion = await createPromotion(admin, {
    kind: "PROMOTION",
    name: "Giảm 10%",
    discountType: "PERCENT",
    value: "10",
  });
  const make = async (overrides: Record<string, unknown>, options?: { months?: number }) =>
    (await createContract(seller, customer.id, await contractInput(overrides, options), randomUUID())).contract;

  // A: paid in full and signed; B: waiting for approval, nothing paid; C: a renewal of A with a PT, a promotion, and
  // part paid; D: ended long ago.
  const a = await make({ signed: true, signedOn: "01/10/2026", signedBy: "Khách" });
  const b = await make({ sessions: 12 });
  const c = await make({
    serviceId: ptService.id,
    sessions: 10,
    contractType: "RENEW",
    previousContractId: a.id,
    contractDate: "05/10/2026",
    startDate: "05/10/2026",
    ptShares: [{ employeeId: trainer.id, percent: 100 }],
    promotionId: promotion.id,
  });
  const d = await make({ contractDate: "01/01/2025", startDate: "01/01/2025", sessions: 2 }, { months: 1 });
  for (const contract of [a, c, d]) await activateContract(approver, contract.id);
  await recordPayment(reception, a.id, { amount: 12_000_000, methodId: CASH, paidOn: "05/10/2026" }, randomUUID());
  await recordPayment(reception, c.id, { amount: 1_000_000, methodId: CASH, paidOn: "05/10/2026" }, randomUUID());
  return { seller, approver, admin, reception, customer, trainer, ptService, promotion, a, b, c, d };
}

const idsOf = async (actor: Actor, query: Record<string, string>) =>
  (await listContracts(actor, { ...query, pageSize: "100" })).items.map((contract) => contract.id).sort();

describe("the contract list's filters (brief §5.3)", () => {
  it("filters by type, contract date, service, PT, promotion, signature, and approval status", async () => {
    const { admin, ptService, trainer, promotion, a, b, c, d } = await scenario();
    const all = [a.id, b.id, c.id, d.id].sort();
    expect(await idsOf(admin, {})).toEqual(all);

    expect(await idsOf(admin, { contractType: "RENEW" })).toEqual([c.id]);
    expect(await idsOf(admin, { from: "03/10/2026", to: "10/10/2026" })).toEqual([c.id]);
    expect(await idsOf(admin, { to: "31/12/2025" })).toEqual([d.id]);
    expect(await idsOf(admin, { serviceId: ptService.id })).toEqual([c.id]);
    expect(await idsOf(admin, { ptId: trainer.id })).toEqual([c.id]);
    expect(await idsOf(admin, { promotionId: promotion.id })).toEqual([c.id]);
    expect(await idsOf(admin, { signed: "true" })).toEqual([a.id]);
    expect(await idsOf(admin, { signed: "false" })).toEqual([b.id, c.id, d.id].sort());
    expect(await idsOf(admin, { status: "DRAFT" })).toEqual([b.id]);
    expect(await idsOf(admin, { status: "ACTIVE" })).toEqual([a.id, c.id].sort());
    expect(await idsOf(admin, { status: "EXPIRED" })).toEqual([d.id]);
  });

  it("filters by payment status, derived from valid receipts", async () => {
    const { admin, a, b, c, d } = await scenario();

    expect(await idsOf(admin, { paymentStatus: "PAID" })).toEqual([a.id]);
    expect(await idsOf(admin, { paymentStatus: "PARTIAL" })).toEqual([c.id]);
    expect(await idsOf(admin, { paymentStatus: "UNPAID" })).toEqual([b.id, d.id].sort());
  });

  it("filters by branch, and combines filters", async () => {
    const { admin, a, c } = await scenario();
    const other = await createTestBranch();

    expect(await idsOf(admin, { branchId: other.id })).toEqual([]);
    expect(await idsOf(admin, { branchId: DEFAULT_BRANCH_ID, status: "ACTIVE", paymentStatus: "PAID" })).toEqual([
      a.id,
    ]);
    expect(await idsOf(admin, { status: "ACTIVE", contractType: "RENEW" })).toEqual([c.id]);
  });

  it("refuses a filter value that is not one of the choices", async () => {
    const { admin } = await scenario();

    await expect(listContracts(admin, { status: "NOPE" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(listContracts(admin, { paymentStatus: "NOPE" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(listContracts(admin, { from: "2026-10-01" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("totals the value, paid, and debt of everything the filters match, not only the page", async () => {
    const { admin, reception } = await scenario();

    // A 12,000,000 paid 12,000,000; B 6,000,000; C 10 x 800,000 less 10% = 7,200,000, paid 1,000,000; D 1,000,000.
    const page = await listContracts(admin, { pageSize: "1" });
    expect(page.items).toHaveLength(1);
    expect(page.totals).toEqual({ contractValue: 26_200_000, paidAmount: 13_000_000, debt: 13_200_000 });
    expect((await listContracts(admin, { paymentStatus: "UNPAID" })).totals).toEqual({
      contractValue: 7_000_000,
      paidAmount: 0,
      debt: 7_000_000,
    });
    expect((await listContracts(reception, { status: "CANCELLED" })).totals).toEqual({
      contractValue: 0,
      paidAmount: 0,
      debt: 0,
    });
  });

  it("shows the branch and the customer's phone", async () => {
    const { admin, a } = await scenario();

    const row = (await listContracts(admin, { q: a.contractCode })).items[0];
    expect(row).toMatchObject({ customerPhone: "0909123456", branch: { id: DEFAULT_BRANCH_ID } });
  });
});

describe("the package history (brief §5.3)", () => {
  it("lists the contract's recorded changes, newest first", async () => {
    const { admin, approver, seller, a } = await scenario();

    const history = await contractHistory(seller, a.id);

    expect(history.map((event) => event.action)).toEqual(["contract.activated", "contract.created"]);
    expect(history[0]).toMatchObject({ actor: { id: approver.id } });
    await expect(contractHistory(admin, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updating the note (A-127)", () => {
  it("works on an approved contract, is audited, and leaves what was sold alone", async () => {
    const { admin, a } = await scenario();

    const updated = await updateContractNote(admin, a.id, { notes: "Khách xin giữ chỗ" });

    expect(updated).toMatchObject({ notes: "Khách xin giữ chỗ", status: "ACTIVE", contractValue: 12_000_000 });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: a.id, action: "contract.note_updated" },
    });
    expect(event).toMatchObject({ actorUserId: admin.id, after: { notes: "Khách xin giữ chỗ" } });
    // Saving the same text again records nothing; an empty note clears it.
    await updateContractNote(admin, a.id, { notes: "Khách xin giữ chỗ" });
    expect(await prisma.auditEvent.count({ where: { entityId: a.id, action: "contract.note_updated" } })).toBe(1);
    expect((await updateContractNote(admin, a.id, { notes: "" })).notes).toBeNull();
    expect((await getContract(admin, a.id)).notes).toBeNull();
  });

  it("needs its own permission, and refuses control characters", async () => {
    const { admin, a } = await scenario();
    const { actor: pt } = await createTestUser("PT");

    await expect(updateContractNote(pt, a.id, { notes: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateContractNote(admin, a.id, { notes: "a\u0000b" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(updateContractNote(admin, randomUUID(), { notes: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
