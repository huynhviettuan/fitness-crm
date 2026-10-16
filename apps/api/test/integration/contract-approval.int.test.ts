import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Actor } from "../../src/platform/auth/session.js";
import { listTrash } from "../../src/platform/trash/trash.service.js";
import { approveRequest, rejectRequest } from "../../src/modules/approvals/approval.service.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import {
  createContract,
  deleteContract,
  getContract,
  listContracts,
  unapproveContract,
  updateContract,
} from "../../src/modules/contracts/contract.service.js";
import { activateContract, rejectContract } from "../../src/modules/contracts/contract-approval.service.js";
import { deletePayment, recordPayment } from "../../src/modules/finance/payment.service.js";
import { createPromotion } from "../../src/modules/promotions/promotion.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId, withoutApprovals } from "../support/factories.js";
import { book, bookingScenario, contractInput } from "../support/bookings.js";

afterEach(resetDatabase);

const OTHER_REJECT = await optionId("rejectReasons", "Khác");
const OTHER_UNAPPROVE = await optionId("unapproveReasons", "Khác");
const OTHER_DELETE = await optionId("deleteReasons", "Khác");
const CASH = await optionId("paymentMethods", "Tiền mặt");

/** A Fitness Manager who sells, another who approves, and an Admin: nobody approves their own (D-018). */
async function setup() {
  const { actor: seller } = await createTestUser("FITNESS_MANAGER");
  const { actor: approver } = await createTestUser("FITNESS_MANAGER");
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const customer = await createCustomer(seller, { fullName: "Nguyễn Văn An", phone: "0909123456" });
  return { seller, approver, admin, customer };
}

async function create(actor: Actor, customerId: string, overrides: Record<string, unknown> = {}) {
  const { contract } = await createContract(actor, customerId, await contractInput(overrides), randomUUID());
  return contract;
}

const reason = (reasonId: string) => ({ reasonId, reasonNote: "Nhập sai" });

describe("a new contract waits for approval through the engine (A-120)", () => {
  it("submits a request for the approvers, with the value, and shows it as pending", async () => {
    const { seller, customer } = await setup();

    const contract = await create(seller, customer.id);

    expect(contract).toMatchObject({ status: "DRAFT", approvalPending: true, approvedBy: null });
    const requests = await prisma.approvalRequest.findMany({ where: { entityId: contract.id } });
    expect(requests).toEqual([
      expect.objectContaining({
        actionType: "contract.create",
        entityType: "contract",
        status: "PENDING",
        submittedById: seller.id,
        title: `${contract.contractCode} · Nguyễn Văn An`,
        amount: expect.anything(),
      }),
    ]);
    expect(Number(requests[0].amount)).toBe(12_000_000);
  });

  it("keeps the request's amount in step with an edited draft", async () => {
    const { seller, customer } = await setup();
    const contract = await create(seller, customer.id);

    await updateContract(seller, contract.id, await contractInput({ sessions: 12 }));

    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: contract.id } });
    expect(Number(request.amount)).toBe(6_000_000);
  });

  it("is active at once when the matrix asks for no approval, with the creator as approver", async () => {
    const { seller, customer } = await setup();
    await prisma.approvalRule.update({ where: { actionType: "contract.create" }, data: { required: false } });

    const contract = await create(seller, customer.id);

    expect(contract).toMatchObject({ status: "ACTIVE", approvedBy: { id: seller.id }, approvalPending: false });
    expect(await prisma.approvalRequest.count({ where: { entityId: contract.id } })).toBe(0);
  });

  it("refuses a creator whose own discount limit is exceeded when no approval is asked for (A-112)", async () => {
    const { seller, admin, customer } = await setup();
    await prisma.approvalRule.update({ where: { actionType: "contract.create" }, data: { required: false } });
    const big = await createPromotion(admin, { kind: "PROMOTION", name: "Lớn", discountType: "PERCENT", value: "20" });

    await expect(create(seller, customer.id, { promotionId: big.id })).rejects.toMatchObject({
      code: "DISCOUNT_ABOVE_LIMIT",
    });
    expect(await prisma.contract.count()).toBe(0);
  });
});

describe("approving (A-121, A-123)", () => {
  it("records who approved and when, and the request is decided", async () => {
    const { seller, approver, customer } = await setup();
    const contract = await create(seller, customer.id);

    const active = await activateContract(approver, contract.id);

    expect(active).toMatchObject({ status: "ACTIVE", approvedBy: { id: approver.id }, approvalPending: false });
    expect(active.approvedAt).toBeInstanceOf(Date);
    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: contract.id } });
    expect(request).toMatchObject({ status: "APPROVED", decidedById: approver.id });
  });

  it("is the same as approving the request in the inbox", async () => {
    const { seller, approver, customer } = await setup();
    const contract = await create(seller, customer.id);
    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: contract.id } });

    await approveRequest(approver, request.id);

    expect((await getContract(seller, contract.id)).status).toBe("ACTIVE");
  });

  it("is never the creator's own, and a role outside the matrix cannot approve", async () => {
    const { seller, customer } = await setup();
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const contract = await create(seller, customer.id);

    await expect(activateContract(seller, contract.id)).rejects.toMatchObject({ code: "APPROVAL_OWN_REQUEST" });
    await expect(activateContract(reception, contract.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getContract(seller, contract.id)).status).toBe("DRAFT");
  });

  it("turns the customer's lead status to Đã ký hợp đồng at the first approval only", async () => {
    const { seller, approver, customer } = await setup();
    const first = await create(seller, customer.id);
    const second = await create(seller, customer.id);

    await activateContract(approver, first.id);
    await activateContract(approver, second.id);

    const person = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(person.leadStatus).toBe("CONTRACTED");
    expect(await prisma.leadStatusChange.count({ where: { customerId: customer.id, toStatus: "CONTRACTED" } })).toBe(1);
  });

  it("leaves a pending contract without effect: no booking until approved (AC-11)", async () => {
    const scenario = await bookingScenario();
    const draft = await create(scenario.manager, scenario.customer.id);

    await expect(book(scenario.manager, { ...scenario, contract: draft })).rejects.toMatchObject({
      code: "CONTRACT_NOT_ACTIVE",
    });
  });
});

describe("rejecting (A-121)", () => {
  it("needs a reason, moves the contract to Rejected, and shows who and why", async () => {
    const { seller, approver, customer } = await setup();
    const contract = await create(seller, customer.id);

    await expect(rejectContract(approver, contract.id, {})).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const rejected = await rejectContract(approver, contract.id, reason(OTHER_REJECT));

    expect(rejected).toMatchObject({
      status: "REJECTED",
      approvalPending: false,
      rejection: { by: { id: approver.id }, reason: { note: "Nhập sai" } },
    });
    expect(await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: contract.id } })).toMatchObject({
      status: "REJECTED",
    });
  });

  it("can be done from the inbox, and a rejected contract is not approved, edited, or booked", async () => {
    const scenario = await bookingScenario();
    const { actor: approver } = await createTestUser("FITNESS_MANAGER");
    const contract = await create(scenario.manager, scenario.customer.id);
    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: contract.id } });
    await rejectRequest(approver, request.id, reason(OTHER_REJECT));

    await expect(activateContract(approver, contract.id)).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
    await expect(updateContract(scenario.manager, contract.id, await contractInput())).rejects.toMatchObject({
      code: "CONTRACT_NOT_EDITABLE",
    });
    await expect(book(scenario.manager, { ...scenario, contract })).rejects.toMatchObject({
      code: "CONTRACT_NOT_ACTIVE",
    });
  });
});

describe("the lock after approval (D-022, brief §5.4)", () => {
  async function activeOne() {
    const { seller, approver, admin, customer } = await setup();
    const contract = await activateContract(approver, (await create(seller, customer.id)).id);
    return { seller, approver, admin, customer, contract };
  }

  it("refuses to edit an approved contract in the service, even for Admin", async () => {
    const { admin, contract } = await activeOne();

    await expect(updateContract(admin, contract.id, await contractInput({ sessions: 12 }))).rejects.toMatchObject({
      code: "CONTRACT_NOT_EDITABLE",
    });
  });

  it("refuses in the database: price, sessions, dates, and the parts cannot change on an approved contract", async () => {
    const { contract } = await activeOne();

    const locked = /locked after approval/;
    await expect(
      prisma.$executeRaw`UPDATE contracts SET contract_value = 1 WHERE id = ${contract.id}::uuid`,
    ).rejects.toThrow(locked);
    await expect(
      prisma.$executeRaw`UPDATE contracts SET total_sessions = 1 WHERE id = ${contract.id}::uuid`,
    ).rejects.toThrow(locked);
    await expect(
      prisma.$executeRaw`UPDATE contracts SET start_date = start_date + 1 WHERE id = ${contract.id}::uuid`,
    ).rejects.toThrow(locked);
    await expect(
      prisma.$executeRaw`UPDATE contracts SET package_name = 'x' WHERE id = ${contract.id}::uuid`,
    ).rejects.toThrow(locked);
    await expect(
      prisma.$executeRaw`DELETE FROM contract_staff_shares WHERE contract_id = ${contract.id}::uuid`,
    ).rejects.toThrow(locked);
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(Number(row.contractValue)).toBe(12_000_000);
    expect(row.totalSessions).toBe(24);
    expect(await prisma.contractStaffShare.count({ where: { contractId: contract.id } })).toBe(1);
  });

  it("still allows the status, the notes, the signature, and the end date", async () => {
    const { contract } = await activeOne();

    await prisma.contract.update({
      where: { id: contract.id },
      data: { notes: "Khách nhờ giữ chỗ", signed: true, endDate: new Date("2031-12-31") },
    });
    await prisma.contract.update({ where: { id: contract.id }, data: { status: "CANCELLED" } });

    expect(await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).toMatchObject({
      notes: "Khách nhờ giữ chỗ",
      status: "CANCELLED",
    });
  });

  it("does not lock a pending contract", async () => {
    const { seller, customer } = await setup();
    const contract = await create(seller, customer.id);

    await prisma.contract.update({ where: { id: contract.id }, data: { contractValue: 5_000_000 } });
  });
});

describe("unapproving (A-124)", () => {
  it("sends an approved contract back to pending, in the creator's name, with a reason", async () => {
    const { seller, approver, admin, customer } = await setup();
    const contract = await activateContract(approver, (await create(seller, customer.id)).id);

    const pending = await unapproveContract(admin, contract.id, reason(OTHER_UNAPPROVE));

    expect(pending).toMatchObject({ status: "DRAFT", approvedBy: null, approvalPending: true });
    const waiting = await prisma.approvalRequest.findFirstOrThrow({
      where: { entityId: contract.id, status: "PENDING" },
    });
    expect(waiting.submittedById).toBe(seller.id);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: contract.id, action: "contract.unapproved" },
    });
    expect(audit).toMatchObject({ actorUserId: admin.id, metadata: expect.objectContaining({ note: "Nhập sai" }) });
    // The creator still cannot approve it; another approver can.
    await expect(activateContract(seller, contract.id)).rejects.toMatchObject({ code: "APPROVAL_OWN_REQUEST" });
    expect((await activateContract(approver, contract.id)).status).toBe("ACTIVE");
  });

  it("is Admin's only, and needs an approved contract and a reason", async () => {
    const { seller, approver, admin, customer } = await setup();
    const pending = await create(seller, customer.id);

    await expect(unapproveContract(approver, pending.id, reason(OTHER_UNAPPROVE))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(unapproveContract(admin, pending.id, reason(OTHER_UNAPPROVE))).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
    const active = await activateContract(approver, pending.id);
    await expect(unapproveContract(admin, active.id, {})).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("is refused while a session is recorded", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const scenario = await bookingScenario();
    await book(scenario.manager, scenario);

    await expect(unapproveContract(admin, scenario.contract.id, reason(OTHER_UNAPPROVE))).rejects.toMatchObject({
      code: "CONTRACT_HAS_DEPENDENTS",
      dependents: [expect.objectContaining({ kind: "booking" })],
    });
  });

  it("is refused while a receipt counts", async () => {
    await withoutApprovals();
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const scenario = await bookingScenario();
    await recordPayment(
      reception,
      scenario.contract.id,
      { amount: 1_000_000, methodId: CASH, paidOn: "05/10/2026" },
      randomUUID(),
    );

    await expect(unapproveContract(admin, scenario.contract.id, reason(OTHER_UNAPPROVE))).rejects.toMatchObject({
      code: "CONTRACT_HAS_DEPENDENTS",
      dependents: [expect.objectContaining({ kind: "payment" })],
    });
  });
});

describe("deleting (A-125, brief §5.4)", () => {
  it("is Admin's only", async () => {
    const { seller, customer } = await setup();
    const contract = await create(seller, customer.id);

    await expect(deleteContract(seller, contract.id, reason(OTHER_DELETE))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("waits for an approver under the matrix, then goes to the trash and leaves every list", async () => {
    const { seller, admin, customer } = await setup();
    const { actor: second } = await createTestUser("ADMIN", { allBranches: true });
    const contract = await create(seller, customer.id);

    const waiting = await deleteContract(admin, contract.id, reason(OTHER_DELETE));
    expect(waiting).not.toBeNull();
    expect((await getContract(admin, contract.id)).status).toBe("DRAFT");

    await approveRequest(second, waiting!.approval.id);

    await expect(getContract(admin, contract.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listContracts(admin, {})).items).toEqual([]);
    const trash = await listTrash(admin, {});
    expect(trash.items).toEqual([
      expect.objectContaining({ entityType: "contract", entityId: contract.id, title: expect.stringContaining("HD") }),
    ]);
    // Its approval request was withdrawn with it.
    expect(
      await prisma.approvalRequest.count({
        where: { entityId: contract.id, actionType: "contract.create", status: "PENDING" },
      }),
    ).toBe(0);
  });

  it("deletes at once when the matrix asks for no approval, and the code is never reused (D-038)", async () => {
    await withoutApprovals();
    const { seller, admin, customer } = await setup();
    const first = await create(seller, customer.id);

    expect(await deleteContract(admin, first.id, reason(OTHER_DELETE))).toBeNull();
    const next = await create(seller, customer.id);

    expect(Number(next.contractCode.slice(2))).toBeGreaterThan(Number(first.contractCode.slice(2)));
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: first.id } });
    expect(row).toMatchObject({ deletedById: admin.id, deleteReasonNote: "Nhập sai" });
  });

  it("is refused while receipts or sessions exist, which are listed; fine once they are deleted", async () => {
    await withoutApprovals();
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const scenario = await bookingScenario();
    const { payment } = await recordPayment(
      reception,
      scenario.contract.id,
      { amount: 1_000_000, methodId: CASH, paidOn: "05/10/2026" },
      randomUUID(),
    );

    await expect(deleteContract(admin, scenario.contract.id, reason(OTHER_DELETE))).rejects.toMatchObject({
      code: "CONTRACT_HAS_DEPENDENTS",
      dependents: [expect.objectContaining({ kind: "payment", id: payment.id })],
    });
    await deletePayment(admin, payment.id, reason(OTHER_DELETE));

    expect(await deleteContract(admin, scenario.contract.id, reason(OTHER_DELETE))).toBeNull();
    await expect(getContract(admin, scenario.contract.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
