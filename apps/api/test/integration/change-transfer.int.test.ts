import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { approveRequest } from "../../src/modules/approvals/approval.service.js";
import {
  getVoucher,
  raiseBranchTransfer,
  raiseRenewal,
  raiseTransfer,
} from "../../src/modules/changes/voucher.service.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { getContract } from "../../src/modules/contracts/contract.service.js";
import { recordPayment } from "../../src/modules/finance/payment.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { book, bookingScenario } from "../support/bookings.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId, withoutApprovals } from "../support/factories.js";

afterEach(resetDatabase);

// Transfer and branch transfer (M8.3; brief §5.6; FR-CHG-001; D-024, D-018, T-050; A-232 to A-239).

async function world() {
  const scenario = await bookingScenario({ sessions: 24 });
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const receiver = await createCustomer(scenario.manager, { fullName: "Trần Thị Bình", phone: "0909000111" });
  return { ...scenario, admin, receiver };
}
type World = Awaited<ReturnType<typeof world>>;

const pendingOf = (voucherId: string) =>
  prisma.approvalRequest.findFirstOrThrow({ where: { entityType: "voucher", entityId: voucherId, status: "PENDING" } });

/** Pays the contract in full, with the approvals off, then puts the voucher approvals back on. */
async function paidInFull(w: World) {
  await withoutApprovals();
  const contract = await getContract(w.admin, w.contract.id);
  await recordPayment(
    w.manager,
    w.contract.id,
    { amount: contract.contractValue, methodId: await optionId("paymentMethods", "Tiền mặt"), paidOn: "05/10/2026" },
    randomUUID(),
  );
  await prisma.approvalRule.updateMany({ where: { actionType: { startsWith: "voucher." } }, data: { required: true } });
}

const transfer = (w: World, patch: Record<string, unknown> = {}) =>
  raiseTransfer(
    w.manager,
    { contractId: w.contract.id, toCustomerId: w.receiver.id, credit: 6_000_000, ...patch },
    randomUUID(),
  );

describe("a transfer (brief §5.6)", () => {
  it("waits with no effect, then empties the contract and makes an approved one for the receiver", async () => {
    const w = await world();
    await paidInFull(w);
    const before = await getContract(w.admin, w.contract.id);
    const { voucher } = await transfer(w, { note: "Chuyển cho bạn" });
    expect(voucher).toMatchObject({
      kind: "TRANSFER",
      status: "PENDING",
      credit: 6_000_000,
      toCustomer: { id: w.receiver.id },
      newContract: null,
      sessionsDelta: 0,
    });
    expect(await getContract(w.admin, w.contract.id)).toMatchObject({ remainingSessions: before.remainingSessions });

    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    const approved = await getVoucher(w.admin, voucher.id);
    expect(approved).toMatchObject({
      status: "APPROVED",
      sessionsDelta: -24,
      valueDelta: -6_000_000,
      newContract: { id: expect.any(String) },
    });

    // The contract given away has nothing left and is worth what was not moved; it is still approved and kept.
    const given = await getContract(w.admin, w.contract.id);
    expect(given).toMatchObject({
      remainingSessions: 0,
      contractValue: before.contractValue - 6_000_000,
      status: "ACTIVE",
    });

    // The receiver's contract: the sessions left, worth the value moved and already paid, to the same end date.
    const received = await getContract(w.admin, approved.newContract!.id);
    expect(received).toMatchObject({
      customer: { id: w.receiver.id },
      contractType: "TRANSFER",
      status: "ACTIVE",
      totalSessions: 24,
      remainingSessions: 24,
      contractValue: 6_000_000,
      paidAmount: 6_000_000,
      debt: 0,
      previousContract: { id: w.contract.id },
    });
    expect(received.endDate.getTime()).toBe(before.endDate.getTime());
    expect(received.contractCode).not.toBe(before.contractCode);
    // The staff shares come along, so the PT and the sale are credited as before.
    expect(await prisma.contractStaffShare.count({ where: { contractId: received.id } })).toBe(
      await prisma.contractStaffShare.count({ where: { contractId: w.contract.id } }),
    );

    const history = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "contract", entityId: w.contract.id, action: "contract.transferred_by_voucher" },
    });
    expect(history.metadata).toMatchObject({ voucherNumber: voucher.voucherNumber, sessionsDelta: -24 });
  });

  it("tells both customers, always", async () => {
    const w = await world();
    await paidInFull(w);
    const { voucher } = await transfer(w);
    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    const out = await prisma.emailMessage.findMany({ where: { event: "change.transferOut" } });
    const into = await prisma.emailMessage.findMany({ where: { event: "change.transferIn" } });
    expect(out).toHaveLength(1);
    expect(into).toHaveLength(1);
    expect(out[0]).toMatchObject({ personId: w.customer.id });
    expect(out[0]!.body).toContain("Trần Thị Bình");
    expect(into[0]).toMatchObject({ personId: w.receiver.id });
    expect(into[0]!.body).toContain("Nguyễn Văn An");
    expect(into[0]!.body).toContain("24 buổi");
  });

  it("cancels the sessions booked from today, each audited, and refuses new ones on the old contract", async () => {
    const w = await world();
    await withoutApprovals();
    const booking = await book(w.manager, w, { date: "15/10/2026" });
    await paidInFull(w);
    const { voucher } = await transfer(w);
    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CANCELLED");
    const cancelled = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "booking", entityId: booking.id, action: "booking.cancelled" },
    });
    expect(cancelled.metadata).toMatchObject({ voucherNumber: voucher.voucherNumber });
    await expect(book(w.manager, w, { date: "16/10/2026" })).rejects.toMatchObject({
      code: "CONTRACT_NO_REMAINING_SESSIONS",
    });
  });

  it("is refused for a contract with debt, the same customer, a stranger, or a credit above the value", async () => {
    const w = await world();
    // Nothing is paid yet: the debt would not move with the sessions.
    await expect(transfer(w)).rejects.toMatchObject({ fieldErrors: { contractId: ["hasDebt"] } });
    await paidInFull(w);
    await expect(transfer(w, { toCustomerId: w.customer.id })).rejects.toMatchObject({
      fieldErrors: { toCustomerId: ["sameCustomer"] },
    });
    await expect(transfer(w, { toCustomerId: randomUUID() })).rejects.toMatchObject({
      fieldErrors: { toCustomerId: ["invalidChoice"] },
    });
    await expect(transfer(w, { credit: 12_000_001 })).rejects.toMatchObject({
      fieldErrors: { credit: ["creditAboveValue"] },
    });
    for (const bad of [{ credit: -1 }, { credit: "x" }, { toCustomerId: "x" }, { note: "a\u0007b" }]) {
      await expect(transfer(w, bad), JSON.stringify(bad)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("is refused at approval when a renewal made after it was raised left something owed", async () => {
    const w = await world();
    await paidInFull(w);
    const { voucher } = await transfer(w);
    const renewal = await raiseRenewal(
      w.manager,
      { contractId: w.contract.id, sessions: 2, amount: 500_000 },
      randomUUID(),
    );
    await approveRequest(w.admin, (await pendingOf(renewal.voucher.id)).id);
    await expect(approveRequest(w.admin, (await pendingOf(voucher.id)).id)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect((await getContract(w.admin, w.contract.id)).remainingSessions).toBe(26);
    expect(await prisma.contract.count({ where: { contractType: "TRANSFER" } })).toBe(0);
  });
});

describe("a branch transfer (brief §5.6)", () => {
  async function twoBranches(w: World) {
    const target = await prisma.branch.create({ data: { name: "Chi nhánh 2" } });
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: w.contract.id } });
    await prisma.serviceBranch.create({ data: { serviceId: contract.serviceId!, branchId: target.id } });
    const { actor: raiser } = await createTestUser("FITNESS_MANAGER", { allBranches: true });
    return { target, raiser, contract };
  }

  it("moves the contract to the other branch only when approved, adds the fee, and cancels the booked sessions", async () => {
    const w = await world();
    const { target, raiser, contract } = await twoBranches(w);
    await withoutApprovals();
    const booking = await book(w.manager, w, { date: "15/10/2026" });
    await prisma.approvalRule.updateMany({
      where: { actionType: { startsWith: "voucher." } },
      data: { required: true },
    });
    const before = await getContract(w.admin, w.contract.id);
    const { voucher } = await raiseBranchTransfer(
      raiser,
      { contractId: w.contract.id, toBranchId: target.id, fee: 500_000 },
      randomUUID(),
    );
    expect(voucher).toMatchObject({ kind: "BRANCH_TRANSFER", amount: 500_000, toBranch: { id: target.id } });
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: w.contract.id } })).branchId).toBe(
      contract.branchId,
    );

    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    const after = await getContract(w.admin, w.contract.id);
    expect(after).toMatchObject({ branch: { id: target.id }, contractValue: before.contractValue + 500_000 });
    expect(after.remainingSessions).toBe(before.remainingSessions);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CANCELLED");
    expect(await prisma.emailMessage.count({ where: { event: "change.branchTransfer" } })).toBe(0);
  });

  it("is the only change to a locked contract the database lets through, and only as the voucher says", async () => {
    const w = await world();
    const { target } = await twoBranches(w);
    const other = await prisma.branch.create({ data: { name: "Chi nhánh 3" } });
    // Without an approved voucher, not even a direct update changes the branch.
    await expect(
      prisma.contract.update({ where: { id: w.contract.id }, data: { branchId: target.id } }),
    ).rejects.toThrow(/locked after approval/);
    await expect(
      prisma.contract.update({ where: { id: w.contract.id }, data: { branchId: other.id } }),
    ).rejects.toThrow(/locked after approval/);
  });

  it("is refused for the same branch, a branch the actor does not work in, or a service not sold there", async () => {
    const w = await world();
    const { target, raiser, contract } = await twoBranches(w);
    const refused = (actor: typeof raiser, patch: Record<string, unknown>) =>
      raiseBranchTransfer(actor, { contractId: w.contract.id, toBranchId: target.id, fee: 0, ...patch }, randomUUID());
    await expect(refused(raiser, { toBranchId: contract.branchId })).rejects.toMatchObject({
      fieldErrors: { toBranchId: ["sameBranch"] },
    });
    // The manager of the first branch alone does not work in the new one.
    await expect(refused(w.manager, {})).rejects.toMatchObject({ fieldErrors: { toBranchId: ["invalidChoice"] } });
    await prisma.serviceBranch.deleteMany({ where: { branchId: target.id } });
    await expect(refused(raiser, {})).rejects.toMatchObject({ fieldErrors: { toBranchId: ["serviceNotInBranch"] } });
    await expect(refused(raiser, { fee: -1 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
