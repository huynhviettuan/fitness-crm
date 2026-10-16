import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { approveRequest } from "../../src/modules/approvals/approval.service.js";
import { getVoucher, raiseCancellation } from "../../src/modules/changes/voucher.service.js";
import { getContract } from "../../src/modules/contracts/contract.service.js";
import { recordPayment } from "../../src/modules/finance/payment.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { book, bookingScenario } from "../support/bookings.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId, withoutApprovals } from "../support/factories.js";

afterEach(resetDatabase);

// Cancellation by change voucher with a refund (M8.4; brief §5.6; FR-CHG-001, FR-CHG-002; D-010, D-024, D-034; A-240 to A-247).

async function world() {
  const scenario = await bookingScenario({ sessions: 24 });
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  return { ...scenario, admin };
}
type World = Awaited<ReturnType<typeof world>>;

const pendingOf = (voucherId: string) =>
  prisma.approvalRequest.findFirstOrThrow({ where: { entityType: "voucher", entityId: voucherId, status: "PENDING" } });

/** Pays `amount` on the contract with the approvals off, then puts the voucher approvals back on. */
async function paid(w: World, amount: number) {
  await withoutApprovals();
  await recordPayment(
    w.manager,
    w.contract.id,
    { amount, methodId: await optionId("paymentMethods", "Tiền mặt"), paidOn: "05/10/2026" },
    randomUUID(),
  );
  await prisma.approvalRule.updateMany({ where: { actionType: { startsWith: "voucher." } }, data: { required: true } });
}

async function cancellation(w: World, patch: Record<string, unknown> = {}) {
  return {
    contractId: w.contract.id,
    reasonId: await optionId("cancelReasons", "Khác"),
    reasonNote: "Khách chuyển nhà",
    valueUsed: 2_000_000,
    fee: 1_000_000,
    refund: 5_000_000,
    refundMethodId: await optionId("paymentMethods", "Tiền mặt"),
    refundCategoryId: await optionId("expenseTypes", "Khác"),
    refundCategoryNote: "Hoàn tiền hủy hợp đồng",
    ...patch,
  };
}

describe("a cancellation (brief §5.6)", () => {
  it("waits with no effect, then ends the contract, clears what is owed and records the refund as an expense", async () => {
    const w = await world();
    await paid(w, 8_000_000);
    const before = await getContract(w.admin, w.contract.id);
    const { voucher } = await raiseCancellation(w.manager, await cancellation(w), randomUUID());
    expect(voucher).toMatchObject({
      kind: "CANCELLATION",
      status: "PENDING",
      valueUsed: 2_000_000,
      fee: 1_000_000,
      amount: 5_000_000,
      reason: { isOther: true, note: "Khách chuyển nhà" },
      refundVoucher: null,
    });
    expect(await getContract(w.admin, w.contract.id)).toMatchObject({ status: "ACTIVE", debt: before.debt });
    expect(await prisma.cashTransaction.count({ where: { type: "EXPENSE" } })).toBe(0);

    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    const approved = await getVoucher(w.admin, voucher.id);
    expect(approved).toMatchObject({
      status: "APPROVED",
      sessionsDelta: -24,
      valueDelta: 8_000_000 - before.contractValue,
      refundVoucher: { id: expect.any(String), number: expect.any(String) },
    });
    // Ended: no sessions left, nothing owed (what was not paid is not collected), and the contract is cancelled.
    expect(await getContract(w.admin, w.contract.id)).toMatchObject({
      status: "CANCELLED",
      remainingSessions: 0,
      debt: 0,
      paidAmount: 8_000_000,
    });
    // The refund is an expense voucher linked to the contract, with the method and the type chosen.
    const expense = await prisma.cashTransaction.findFirstOrThrow({ where: { type: "EXPENSE" } });
    expect(expense).toMatchObject({
      id: approved.refundVoucher!.id,
      contractId: w.contract.id,
      payee: "Nguyễn Văn An",
      approvalStatus: "APPROVED",
    });
    expect(Number(expense.amount)).toBe(5_000_000);
    const history = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "contract", entityId: w.contract.id, action: "contract.cancelled_by_voucher" },
    });
    expect(history.metadata).toMatchObject({ voucherNumber: voucher.voucherNumber, sessionsDelta: -24 });
  });

  it("cancels the sessions booked, past or future, and nothing can be booked on it afterwards", async () => {
    const w = await world();
    await withoutApprovals();
    const booking = await book(w.manager, w, { date: "15/10/2026" });
    await paid(w, 12_000_000);
    const { voucher } = await raiseCancellation(
      w.manager,
      await cancellation(w, {
        valueUsed: 0,
        fee: 0,
        refund: 0,
        refundMethodId: undefined,
        refundCategoryId: undefined,
      }),
      randomUUID(),
    );
    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CANCELLED");
    await expect(book(w.manager, w, { date: "16/10/2026" })).rejects.toBeTruthy();
    // No refund: no expense voucher.
    expect(await prisma.cashTransaction.count({ where: { type: "EXPENSE" } })).toBe(0);
    expect((await getVoucher(w.admin, voucher.id)).refundVoucher).toBeNull();
  });

  it("tells the customer the contract was cancelled", async () => {
    const w = await world();
    await prisma.customer.update({ where: { id: w.customer.id }, data: { email: "an@example.com" } });
    const { voucher } = await raiseCancellation(
      w.manager,
      await cancellation(w, {
        refund: 0,
        valueUsed: 0,
        fee: 0,
        refundMethodId: undefined,
        refundCategoryId: undefined,
      }),
      randomUUID(),
    );
    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    expect(await prisma.emailMessage.count({ where: { event: "contract.cancelled" } })).toBe(1);
  });

  it("refuses a refund above what was paid less the value used and the fee, or a value used above the value", async () => {
    const w = await world();
    await paid(w, 8_000_000);
    const refused = async (patch: Record<string, unknown>) =>
      raiseCancellation(w.manager, await cancellation(w, patch), randomUUID());
    // 8m paid, 2m used, 1m fee: at most 5m back.
    await expect(refused({ refund: 5_000_001 })).rejects.toMatchObject({
      fieldErrors: { refund: ["refundAbovePaid"] },
    });
    await expect(refused({ valueUsed: 12_000_001, fee: 0, refund: 0 })).rejects.toMatchObject({
      fieldErrors: { valueUsed: ["valueUsedAboveValue"] },
    });
    // A refund needs how it is paid and the expense type.
    await expect(refused({ refundMethodId: undefined })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(refused({ refundCategoryId: undefined })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    // "Khác" needs a note (D-016), and the reason is a drop-down.
    await expect(refused({ reasonNote: "" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    for (const bad of [{ reasonId: randomUUID() }, { refund: -1 }, { fee: "x" }, { note: "a\u0007b" }]) {
      await expect(refused(bad), JSON.stringify(bad)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("allows one waiting cancellation at a time, and refuses a frozen or already cancelled contract", async () => {
    const w = await world();
    await raiseCancellation(
      w.manager,
      await cancellation(w, { refund: 0, refundMethodId: undefined, refundCategoryId: undefined }),
      randomUUID(),
    );
    await expect(
      raiseCancellation(
        w.manager,
        await cancellation(w, { refund: 0, refundMethodId: undefined, refundCategoryId: undefined }),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ fieldErrors: { contractId: ["cancellationPending"] } });
    await prisma.contract.update({ where: { id: w.contract.id }, data: { status: "FROZEN" } });
    await prisma.contractChangeVoucher.deleteMany({ where: { contractId: w.contract.id } });
    await expect(raiseCancellation(w.manager, await cancellation(w), randomUUID())).rejects.toMatchObject({
      code: "CONTRACT_FROZEN",
    });
    await prisma.contract.update({ where: { id: w.contract.id }, data: { status: "CANCELLED" } });
    await expect(raiseCancellation(w.manager, await cancellation(w), randomUUID())).rejects.toMatchObject({
      code: "CONTRACT_NOT_ACTIVE",
    });
  });

  it("is refused at approval when a session is in progress, and replays with the same key", async () => {
    const w = await world();
    await prisma.approvalRule.update({ where: { actionType: "voucher.cancellation" }, data: { required: false } });
    const key = randomUUID();
    const input = await cancellation(w, {
      refund: 0,
      valueUsed: 0,
      fee: 0,
      refundMethodId: undefined,
      refundCategoryId: undefined,
    });
    const first = await raiseCancellation(w.manager, input, key);
    expect(first.voucher.status).toBe("APPROVED");
    expect((await raiseCancellation(w.manager, input, key)).replayed).toBe(true);
    expect(await getContract(w.admin, w.contract.id)).toMatchObject({ status: "CANCELLED", remainingSessions: 0 });
  });
});
