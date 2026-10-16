import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Actor } from "../../src/platform/auth/session.js";
import { approvalSummary, listApprovals, listRules, updateRule } from "../../src/platform/approvals/approval.engine.js";
import { approveRequest, rejectRequest } from "../../src/modules/approvals/approval.service.js";
import { createCustomer, getCustomer, updateCustomer } from "../../src/modules/customers/customer.service.js";
import { getContract } from "../../src/modules/contracts/contract.service.js";
import { deletePayment, listPayments, recordPayment } from "../../src/modules/finance/payment.service.js";
import { financeSummary, recordCashTransaction } from "../../src/modules/finance/cash.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestBranch, createTestOption, createTestUser, optionId, roleId } from "../support/factories.js";
import { activeContract } from "../support/bookings.js";

afterEach(async () => {
  vi.useRealTimers();
  await resetDatabase();
});

const CASH = await optionId("paymentMethods", "Tiền mặt");
const OTHER_DELETE = await optionId("deleteReasons", "Khác");
const OTHER_REJECT = await optionId("rejectReasons", "Khác");

/** A receptionist who records, two Fitness Managers who approve, and a 12,000,000 contract. */
async function setup() {
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  const { actor: manager } = await createTestUser("FITNESS_MANAGER");
  const { actor: otherManager } = await createTestUser("FITNESS_MANAGER");
  const customer = await createCustomer(reception, { fullName: "Nguyễn Văn An", phone: "0909123456" });
  const contract = await activeContract(manager, customer.id);
  return { reception, manager, otherManager, customer, contract };
}

const pay = (actor: Actor, contractId: string, amount: number) =>
  recordPayment(actor, contractId, { amount, methodId: CASH, paidOn: "05/10/2026" }, randomUUID());

const requestFor = (entityId: string, action?: string) =>
  prisma.approvalRequest.findFirstOrThrow({
    where: { entityId, ...(action ? { actionType: action } : {}) },
    orderBy: { submittedAt: "desc" },
  });

describe("a receipt under the approval matrix (D-018, AC-05)", () => {
  it("is pending and counts for nothing until a Fitness Manager approves it", async () => {
    const { reception, manager, contract } = await setup();

    const { payment } = await pay(reception, contract.id, 5_000_000);

    expect(payment.approvalStatus).toBe("PENDING");
    expect(await getContract(manager, contract.id)).toMatchObject({ paidAmount: 0, debt: 12_000_000 });
    const [item] = (await listApprovals(manager, {})).items;
    expect(item).toMatchObject({
      action: "payment.create",
      entityId: payment.id,
      title: `${payment.receiptNumber} · ${contract.contractCode} · Nguyễn Văn An`,
      amount: 5_000_000,
      status: "PENDING",
      submittedBy: { id: reception.id },
      canDecide: true,
      overdue: false,
    });

    await approveRequest(manager, item.id);

    expect(await getContract(manager, contract.id)).toMatchObject({ paidAmount: 5_000_000, debt: 7_000_000 });
    expect((await listPayments(manager, { contractId: contract.id })).items[0].approvalStatus).toBe("APPROVED");
    expect(await requestFor(payment.id)).toMatchObject({ status: "APPROVED", decidedById: manager.id });
    expect(
      await prisma.auditEvent.findFirst({ where: { entityId: payment.id, action: "payment.approved" } }),
    ).toMatchObject({
      actorUserId: manager.id,
      before: { approvalStatus: "PENDING" },
      after: { approvalStatus: "APPROVED" },
    });
  });

  it("nobody approves their own submission, even with approval rights", async () => {
    const { manager, otherManager, contract } = await setup();
    const { payment } = await pay(manager, contract.id, 5_000_000);
    const request = await requestFor(payment.id);

    await expect(approveRequest(manager, request.id)).rejects.toMatchObject({ code: "APPROVAL_OWN_REQUEST" });
    expect((await listApprovals(manager, {})).total).toBe(0);
    expect((await listApprovals(manager, { view: "mine" })).items[0]).toMatchObject({
      id: request.id,
      canDecide: false,
    });

    await approveRequest(otherManager, request.id);
    expect((await getContract(manager, contract.id)).paidAmount).toBe(5_000_000);
  });

  it("only approvers of the action, in the request's branch, decide", async () => {
    const { reception, contract } = await setup();
    const { payment } = await pay(reception, contract.id, 5_000_000);
    const request = await requestFor(payment.id);
    const { actor: otherReception } = await createTestUser("RECEPTIONIST");
    const elsewhere = await createTestUser("FITNESS_MANAGER", { branchIds: [(await createTestBranch()).id] });

    await expect(approveRequest(otherReception, request.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(approveRequest(elsewhere.actor, request.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listApprovals(elsewhere.actor, {})).total).toBe(0);
  });

  it("a rejection needs a reason; the receipt never counts, and the request is decided once", async () => {
    const { reception, manager, otherManager, contract } = await setup();
    const { payment } = await pay(reception, contract.id, 5_000_000);
    const request = await requestFor(payment.id);

    await expect(rejectRequest(manager, request.id, { reasonId: OTHER_REJECT, reasonNote: " " })).rejects.toMatchObject(
      {
        fieldErrors: { reasonNote: ["otherNeedsNote"] },
      },
    );
    await rejectRequest(manager, request.id, { reasonId: OTHER_REJECT, reasonNote: "Sai số tiền" });

    expect((await listPayments(manager, { contractId: contract.id })).items[0].approvalStatus).toBe("REJECTED");
    expect((await getContract(manager, contract.id)).paidAmount).toBe(0);
    expect((await listApprovals(reception, { view: "mine" })).items[0]).toMatchObject({
      status: "REJECTED",
      decidedBy: { id: manager.id },
      rejectReason: { labelVi: "Khác", note: "Sai số tiền" },
    });
    await expect(approveRequest(otherManager, request.id)).rejects.toMatchObject({ code: "APPROVAL_NOT_PENDING" });
  });

  it("two approvers at once: one decision, applied once", async () => {
    const { reception, manager, otherManager, contract } = await setup();
    const { payment } = await pay(reception, contract.id, 5_000_000);
    const request = await requestFor(payment.id);

    const results = await Promise.allSettled([
      approveRequest(manager, request.id),
      approveRequest(otherManager, request.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "APPROVAL_NOT_PENDING" } });
    expect(await prisma.auditEvent.count({ where: { entityId: payment.id, action: "payment.approved" } })).toBe(1);
  });

  it("pending receipts count toward what the contract can still take (A-038)", async () => {
    const { reception, contract } = await setup();
    await pay(reception, contract.id, 10_000_000);

    await expect(pay(reception, contract.id, 3_000_000)).rejects.toMatchObject({
      code: "PAYMENT_EXCEEDS_CONTRACT_VALUE",
    });
  });
});

describe("other actions under the matrix", () => {
  it("an income or expense is pending and left out of the totals until approved", async () => {
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const { actor: admin } = await createTestUser("ADMIN");
    const categoryId = await createTestOption("expenseTypes", "Điện nước");
    const { transaction } = await recordCashTransaction(
      accountant,
      {
        type: "EXPENSE",
        categoryId,
        methodId: await optionId("paymentMethods", "Tiền mặt"),
        payee: "Công ty điện lực",
        amount: "1.500.000",
        occurredOn: "03/10/2026",
      },
      randomUUID(),
    );
    const period = { from: "01/10/2026", to: "31/10/2026" };

    expect(transaction.approvalStatus).toBe("PENDING");
    expect((await financeSummary(admin, period)).expense).toBe(0);
    await approveRequest(admin, (await requestFor(transaction.id)).id);
    expect((await financeSummary(admin, period)).expense).toBe(1_500_000);
  });

  it("a deletion waits for an admin; until then the receipt stays in effect, and a second request is refused", async () => {
    const { manager, contract } = await setup();
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const { actor: admin } = await createTestUser("ADMIN");
    await prisma.approvalRule.update({ where: { actionType: "payment.create" }, data: { required: false } });
    const { payment } = await pay(manager, contract.id, 5_000_000);
    const reason = { reasonId: OTHER_DELETE, reasonNote: "Ghi nhầm" };

    expect(await deletePayment(accountant, payment.id, reason)).toMatchObject({ approval: { id: expect.any(String) } });
    expect((await getContract(manager, contract.id)).paidAmount).toBe(5_000_000);
    await expect(deletePayment(accountant, payment.id, reason)).rejects.toMatchObject({
      code: "APPROVAL_ALREADY_PENDING",
    });
    const [item] = (await listApprovals(admin, {})).items;
    expect(item).toMatchObject({ action: "record.delete", changes: { reason: { labelVi: "Khác", note: "Ghi nhầm" } } });

    await approveRequest(admin, item.id);

    expect((await getContract(manager, contract.id)).paidAmount).toBe(0);
    // The trash names who asked; the approver is on the request.
    expect(await prisma.trashEntry.findFirst({ where: { entityId: payment.id } })).toMatchObject({
      deletedById: accountant.id,
      reasonNote: "Ghi nhầm",
    });
  });

  it("deleting a receipt still waiting for approval withdraws that request", async () => {
    const { reception, contract } = await setup();
    const { actor: admin } = await createTestUser("ADMIN");
    await prisma.approvalRule.update({ where: { actionType: "record.delete" }, data: { required: false } });
    const { payment } = await pay(reception, contract.id, 5_000_000);

    await deletePayment(admin, payment.id, { reasonId: OTHER_DELETE, reasonNote: "Trùng" });

    expect(await requestFor(payment.id, "payment.create")).toMatchObject({ status: "CANCELLED", decidedById: null });
  });

  it("a change of name, phone, or email waits for a Fitness Manager; the other fields change at once", async () => {
    const { reception, manager, customer } = await setup();

    const { customer: edited, approval } = await updateCustomer(reception, customer.id, {
      fullName: "Nguyễn Văn An",
      phone: "0911 222 333",
      notes: "Thích tập buổi sáng",
    });

    expect(approval).not.toBeNull();
    expect(edited).toMatchObject({
      phone: "0909123456",
      notes: "Thích tập buổi sáng",
      pendingIdentity: { phone: "0911222333" },
    });
    await approveRequest(manager, approval!.id);
    expect(await getCustomer(manager, customer.id)).toMatchObject({ phone: "0911222333", pendingIdentity: null });
    expect(
      await prisma.auditEvent.findFirst({
        where: { entityId: customer.id, action: "customer.updated", actorUserId: manager.id },
      }),
    ).toMatchObject({
      before: { phone: "0909123456" },
      after: { phone: "0911222333" },
      metadata: { approvalRequestId: approval!.id },
    });
  });
});

describe("the approval matrix (FR-PLT-006, AC-05)", () => {
  it("an admin switches approval off or changes approvers, and it takes effect at once", async () => {
    const { reception, manager, contract } = await setup();
    const { actor: admin } = await createTestUser("ADMIN");
    const { payment: waiting } = await pay(reception, contract.id, 1_000_000);

    await updateRule(admin, "payment.create", {
      required: true,
      approverRoleIds: [await roleId("ADMIN")],
      overdueHours: 24,
    });
    expect((await listApprovals(manager, {})).total).toBe(0);
    await expect(approveRequest(manager, (await requestFor(waiting.id)).id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await updateRule(admin, "payment.create", { required: false, approverRoleIds: [], overdueHours: 24 });
    const { payment } = await pay(reception, contract.id, 2_000_000);
    expect(payment.approvalStatus).toBe("APPROVED");
    expect((await listRules(admin)).find((rule) => rule.action === "payment.create")).toMatchObject({
      required: false,
      approvers: [],
    });
    expect(await prisma.auditEvent.count({ where: { action: "approval_rule.updated" } })).toBe(2);
  });

  it("only admin manages it, and a rule that needs approval names an approver", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: admin } = await createTestUser("ADMIN");

    await expect(listRules(manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateRule(admin, "payment.create", { required: true, approverRoleIds: [], overdueHours: 24 }),
    ).rejects.toMatchObject({
      fieldErrors: { approverRoleIds: ["approverRequired"] },
    });
    await expect(
      updateRule(admin, "lead.create", { required: false, approverRoleIds: [], overdueHours: 24 }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("counts what waits for an approver, and what is overdue", async () => {
    const { reception, manager, contract } = await setup();
    await pay(reception, contract.id, 1_000_000);

    expect(await approvalSummary(manager)).toEqual({ toDecide: 1, overdue: 0 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 25 * 3_600_000));
    expect(await approvalSummary(manager)).toEqual({ toDecide: 1, overdue: 1 });
    expect((await approvalSummary(reception)).toDecide).toBe(0);
  });

  it("the database refuses a request decided by its submitter", async () => {
    const { reception, contract } = await setup();
    const { payment } = await pay(reception, contract.id, 1_000_000);
    const request = await requestFor(payment.id);

    await expect(
      prisma.approvalRequest.update({
        where: { id: request.id },
        data: { status: "APPROVED", decidedById: reception.id, decidedAt: new Date() },
      }),
    ).rejects.toThrow(/approval_requests_not_own/);
  });
});
