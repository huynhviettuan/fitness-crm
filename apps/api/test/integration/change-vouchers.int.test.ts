import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { approveRequest, rejectRequest } from "../../src/modules/approvals/approval.service.js";
import { getVoucher, listVouchers, raiseHold, raiseRenewal } from "../../src/modules/changes/voucher.service.js";
import { cancelBooking, createBooking } from "../../src/modules/bookings/booking.service.js";
import { deactivateContract } from "../../src/modules/contracts/contract-freeze.service.js";
import { deleteContract, getContract } from "../../src/modules/contracts/contract.service.js";
import { recordPayment } from "../../src/modules/finance/payment.service.js";
import { completeSession } from "../../src/modules/sessions/session.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId, withoutApprovals, type RoleCode } from "../support/factories.js";
import { book, bookingScenario, createTrainer } from "../support/bookings.js";

afterEach(resetDatabase);

// Contract change vouchers: renewal and hold (M8.1; brief §5.6; FR-CHG-001, FR-CHG-002; D-024, D-018, T-050; A-219 to A-226).

const iso = (day: Date) => day.toISOString().slice(0, 10);

async function world(options: { sessions?: number } = {}) {
  const scenario = await bookingScenario({ sessions: options.sessions ?? 24 });
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  return { ...scenario, admin };
}
type World = Awaited<ReturnType<typeof world>>;

const pendingOf = (voucherId: string) =>
  prisma.approvalRequest.findFirstOrThrow({ where: { entityType: "voucher", entityId: voucherId, status: "PENDING" } });

/** A renewal raised by the manager and approved by Admin; returns the contract as it is after. */
async function renewed(w: World, input: Record<string, unknown>) {
  const { voucher } = await raiseRenewal(w.manager, { contractId: w.contract.id, ...input }, randomUUID());
  await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
  return { voucher: await getVoucher(w.admin, voucher.id), contract: await getContract(w.admin, w.contract.id) };
}

describe("a renewal (brief §5.6)", () => {
  it("waits for approval with no effect, then adds the sessions, the days and the amount owed", async () => {
    const w = await world();
    const before = await getContract(w.admin, w.contract.id);
    const { voucher, replayed } = await raiseRenewal(
      w.manager,
      { contractId: w.contract.id, months: "1", days: "0", sessions: "12", amount: "3.000.000", note: "Khách tái ký" },
      randomUUID(),
    );
    expect(replayed).toBe(false);
    expect(voucher).toMatchObject({
      status: "PENDING",
      kind: "RENEWAL",
      voucherNumber: expect.stringMatching(/^BD\d{6}$/),
      sessions: 12,
      amount: 3_000_000,
      note: "Khách tái ký",
      sessionsDelta: 0,
      valueDelta: 0,
      contract: { id: w.contract.id },
      customer: { id: w.customer.id },
    });
    expect(voucher.pendingRequestId).not.toBeNull();
    // From the day after the end, a month long.
    expect(iso(voucher.fromDate!)).toBe(iso(new Date(before.endDate.getTime() + 86_400_000)));
    // Waiting has no effect on the contract.
    const waiting = await getContract(w.admin, w.contract.id);
    expect(waiting).toMatchObject({
      totalSessions: before.totalSessions,
      contractValue: before.contractValue,
      voucherSessions: 0,
      voucherValue: 0,
    });
    expect(iso(waiting.endDate)).toBe(iso(before.endDate));

    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    const approved = await getVoucher(w.admin, voucher.id);
    expect(approved).toMatchObject({
      status: "APPROVED",
      sessionsDelta: 12,
      valueDelta: 3_000_000,
      approvedBy: { id: w.admin.id },
      pendingRequestId: null,
    });
    expect(iso(approved.endDateBefore!)).toBe(iso(before.endDate));
    expect(iso(approved.endDateAfter!)).toBe(iso(voucher.toDate!));

    const after = await getContract(w.admin, w.contract.id);
    expect(after).toMatchObject({
      voucherSessions: 12,
      voucherValue: 3_000_000,
      totalSessions: before.totalSessions + 12,
      remainingSessions: before.remainingSessions + 12,
      contractValue: before.contractValue + 3_000_000,
      debt: before.debt + 3_000_000,
      // What was sold stays as it was: the contract itself is never edited (D-022).
      sessionsBought: before.sessionsBought,
    });
    expect(iso(after.endDate)).toBe(iso(voucher.toDate!));
    // The database sums the approved vouchers into the contract.
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: w.contract.id } });
    expect(row).toMatchObject({ voucherSessions: 12, contractValue: expect.anything() });
    expect(Number(row.voucherValue)).toBe(3_000_000);
    expect(Number(row.contractValue)).toBe(before.contractValue);

    // The audit says who raised and who approved, and the contract's own history shows what it did.
    const events = await prisma.auditEvent.findMany({ where: { entityId: voucher.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.action)).toEqual([
      "contract_change_voucher.created",
      "contract_change_voucher.approved",
    ]);
    const history = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "contract", entityId: w.contract.id, action: "contract.renewed_by_voucher" },
    });
    expect(history.metadata).toMatchObject({ voucherNumber: voucher.voucherNumber, sessionsDelta: 12 });
  });

  it("tells the customer, always: it is a mandatory email that fails with a task when there is no address", async () => {
    const w = await world();
    await renewed(w, { sessions: 5, amount: 0 });
    const emails = await prisma.emailMessage.findMany({ where: { event: "change.renewal" } });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ personId: w.customer.id, locale: "vi", status: "FAILED" });
    expect(emails[0]!.subject).toContain("BD");
    expect(emails[0]!.body).toContain("thêm 5 buổi");
  });

  it("adds only sessions when only sessions are asked, and keeps a later end date", async () => {
    const w = await world();
    const before = await getContract(w.admin, w.contract.id);
    const { contract, voucher } = await renewed(w, { sessions: 4 });
    expect(contract.remainingSessions).toBe(before.remainingSessions + 4);
    expect(iso(contract.endDate)).toBe(iso(before.endDate));
    expect(voucher.toDate).toBeNull();
    expect(voucher.endDateAfter && iso(voucher.endDateAfter)).toBe(iso(before.endDate));
    // A month that ends before the contract does is not a shorter contract.
    const early = await raiseRenewal(
      w.manager,
      { contractId: w.contract.id, fromDate: "05/10/2026", months: 1, sessions: 1 },
      randomUUID(),
    );
    await approveRequest(w.admin, (await pendingOf(early.voucher.id)).id);
    expect(iso((await getContract(w.admin, w.contract.id)).endDate)).toBe(iso(before.endDate));
  });

  it("can be asked for by the day it starts, and an expired contract is renewed from today", async () => {
    const w = await world();
    const typed = await raiseRenewal(
      w.manager,
      { contractId: w.contract.id, fromDate: "01/01/2032", months: 2, sessions: 3 },
      randomUUID(),
    );
    expect(iso(typed.voucher.fromDate!)).toBe("2032-01-01");
    expect(iso(typed.voucher.toDate!)).toBe("2032-02-29");
  });

  it("is refused for an input with nothing to add, a bad number, or a bad day", async () => {
    const w = await world();
    for (const bad of [
      {},
      { months: 0, days: 0, sessions: 0 },
      { sessions: -1 },
      { sessions: 1001 },
      { sessions: 1.5 },
      { months: "x" },
      { sessions: 1, amount: -5 },
      { sessions: 1, fromDate: "99/99/2026" },
      { sessions: 1, note: "a\u0007b" },
    ]) {
      await expect(
        raiseRenewal(w.manager, { contractId: w.contract.id, ...bad }, randomUUID()),
        JSON.stringify(bad),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    await expect(raiseRenewal(w.manager, { contractId: "nope", sessions: 1 }, randomUUID())).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(
      raiseRenewal(w.manager, { contractId: randomUUID(), sessions: 1 }, randomUUID()),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("adds capacity to book more sessions, and lets the customer pay the new amount and no more", async () => {
    const w = await world({ sessions: 1 });
    await withoutApprovals();
    await book(w.manager, w, { date: "15/10/2026" });
    await expect(book(w.manager, w, { date: "16/10/2026" })).rejects.toMatchObject({
      code: "CONTRACT_NO_REMAINING_SESSIONS",
    });
    await prisma.approvalRule.updateMany({ where: { actionType: "voucher.renewal" }, data: { required: true } });
    const { contract } = await renewed(w, { sessions: 2, amount: 1_000_000 });
    // Two more than before; the one booked is not yet used.
    expect(contract.remainingSessions).toBe(3);
    await book(w.manager, w, { date: "16/10/2026" });

    // The payment ceiling is the contract's value with the voucher's amount.
    const cash = await optionId("paymentMethods", "Tiền mặt");
    const pay = (amount: number) =>
      recordPayment(w.manager, w.contract.id, { amount, methodId: cash, paidOn: "05/10/2026" }, randomUUID());
    await expect(pay(contract.contractValue + 1)).rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_CONTRACT_VALUE" });
    await pay(contract.contractValue);
  });

  it("acts at once when Admin has switched the approval off", async () => {
    const w = await world();
    await prisma.approvalRule.update({ where: { actionType: "voucher.renewal" }, data: { required: false } });
    const { voucher } = await raiseRenewal(w.manager, { contractId: w.contract.id, sessions: 6 }, randomUUID());
    expect(voucher).toMatchObject({ status: "APPROVED", sessionsDelta: 6, pendingRequestId: null });
    expect((await getContract(w.admin, w.contract.id)).voucherSessions).toBe(6);
  });
});

describe("deciding a voucher (D-018)", () => {
  it("is not decided by whoever raised it, and a rejection has no effect", async () => {
    const w = await world();
    const { voucher } = await raiseRenewal(w.manager, { contractId: w.contract.id, sessions: 12 }, randomUUID());
    const request = await pendingOf(voucher.id);
    await expect(approveRequest(w.manager, request.id)).rejects.toMatchObject({ code: "APPROVAL_OWN_REQUEST" });

    const reason = await optionId("rejectReasons", "Khác");
    await rejectRequest(w.admin, request.id, { reasonId: reason, reasonNote: "Chưa thanh toán" });
    expect(await getVoucher(w.admin, voucher.id)).toMatchObject({
      status: "REJECTED",
      sessionsDelta: 0,
      valueDelta: 0,
    });
    expect(await getContract(w.admin, w.contract.id)).toMatchObject({ voucherSessions: 0, voucherValue: 0 });
    await expect(approveRequest(w.admin, request.id)).rejects.toMatchObject({ code: "APPROVAL_NOT_PENDING" });
  });

  it("is decided once when two approvers act at once", async () => {
    const w = await world();
    const { actor: second } = await createTestUser("ADMIN", { allBranches: true });
    const { voucher } = await raiseRenewal(w.manager, { contractId: w.contract.id, sessions: 12 }, randomUUID());
    const request = await pendingOf(voucher.id);
    const results = await Promise.allSettled([approveRequest(w.admin, request.id), approveRequest(second, request.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await getContract(w.admin, w.contract.id)).voucherSessions).toBe(12);
  });

  it("stops being applicable when the contract is no longer running at the decision", async () => {
    const w = await world();
    const { voucher } = await raiseRenewal(w.manager, { contractId: w.contract.id, sessions: 12 }, randomUUID());
    await deactivateContract(w.admin, w.contract.id, {
      reasonId: await optionId("freezeReasons", "Khác"),
      reasonNote: "Kiểm tra",
    });
    await expect(approveRequest(w.admin, (await pendingOf(voucher.id)).id)).rejects.toMatchObject({
      code: "CONTRACT_FROZEN",
    });
    expect((await getVoucher(w.admin, voucher.id)).status).toBe("PENDING");
  });

  it("is never edited or removed once decided, not even by SQL", async () => {
    const w = await world();
    const { voucher } = await renewed(w, { sessions: 12, amount: 100 });
    await expect(
      prisma.$executeRaw`UPDATE contract_change_vouchers SET sessions_delta = 99 WHERE id = ${voucher.id}::uuid`,
    ).rejects.toThrow(/cannot change/);
    await expect(
      prisma.$executeRaw`DELETE FROM contract_change_vouchers WHERE id = ${voucher.id}::uuid`,
    ).rejects.toThrow(/cannot be removed/);
    // What was sold stays locked too (D-022).
    await expect(
      prisma.$executeRaw`UPDATE contracts SET total_sessions = total_sessions + 1 WHERE id = ${w.contract.id}::uuid`,
    ).rejects.toThrow(/locked/);
  });
});

describe("the same request twice (T-015)", () => {
  it("returns the first voucher for the same key and content, and refuses other content with the key", async () => {
    const w = await world();
    const key = randomUUID();
    const input = { contractId: w.contract.id, sessions: 3, amount: 500 };
    const first = await raiseRenewal(w.manager, input, key);
    const again = await raiseRenewal(w.manager, input, key);
    expect(again.replayed).toBe(true);
    expect(again.voucher.id).toBe(first.voucher.id);
    await expect(raiseRenewal(w.manager, { ...input, sessions: 4 }, key)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    await expect(raiseRenewal(w.manager, input, undefined)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    await expect(raiseRenewal(w.manager, input, "nope")).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    expect(await prisma.contractChangeVoucher.count()).toBe(1);
  });

  it("makes one voucher when two requests with one key arrive together, and numbers are never reused", async () => {
    const w = await world();
    const key = randomUUID();
    const input = { contractId: w.contract.id, sessions: 3 };
    const results = await Promise.all([raiseRenewal(w.manager, input, key), raiseRenewal(w.manager, input, key)]);
    expect(new Set(results.map((result) => result.voucher.id)).size).toBe(1);
    expect(await prisma.contractChangeVoucher.count()).toBe(1);
    const other = await raiseRenewal(w.manager, { contractId: w.contract.id, sessions: 1 }, randomUUID());
    expect(other.voucher.voucherNumber).not.toBe(results[0]!.voucher.voucherNumber);
  });
});

describe("who may raise a voucher, and on what", () => {
  it("is for the roles that raise contracts, on the contracts they can see", async () => {
    const w = await world();
    for (const role of ["PT", "ACCOUNTANT", "MARKETING"] as RoleCode[]) {
      const { actor } = await createTestUser(role, { allBranches: true });
      await expect(
        raiseRenewal(actor, { contractId: w.contract.id, sessions: 1 }, randomUUID()),
        role,
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const { actor: elsewhere } = await createTestUser("FITNESS_MANAGER", {
      branchIds: [(await (await import("../support/factories.js")).createTestBranch()).id],
    });
    await expect(
      raiseRenewal(elsewhere, { contractId: w.contract.id, sessions: 1 }, randomUUID()),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("is not for a contract that is pending, frozen or cancelled", async () => {
    const w = await world();
    await deactivateContract(w.admin, w.contract.id, {
      reasonId: await optionId("freezeReasons", "Khác"),
      reasonNote: "Kiểm tra",
    });
    await expect(
      raiseRenewal(w.manager, { contractId: w.contract.id, sessions: 1 }, randomUUID()),
    ).rejects.toMatchObject({
      code: "CONTRACT_FROZEN",
    });
    await expect(
      raiseHold(w.manager, { contractId: w.contract.id, fromDate: "12/10/2026", toDate: "13/10/2026" }, randomUUID()),
    ).rejects.toMatchObject({ code: "CONTRACT_FROZEN" });
  });

  it("is listed with filters for those who see the contract, and a contract with vouchers is not deleted", async () => {
    const w = await world();
    const first = await raiseRenewal(w.manager, { contractId: w.contract.id, sessions: 1 }, randomUUID());
    await raiseHold(
      w.manager,
      { contractId: w.contract.id, fromDate: "12/10/2026", toDate: "13/10/2026" },
      randomUUID(),
    );
    expect((await listVouchers(w.admin, {})).total).toBe(2);
    expect((await listVouchers(w.admin, { kind: "HOLD" })).items).toHaveLength(1);
    expect((await listVouchers(w.admin, { contractId: w.contract.id, status: "PENDING" })).total).toBe(2);
    expect((await listVouchers(w.admin, { customerId: randomUUID() })).total).toBe(0);
    await expect(listVouchers(w.admin, { kind: "OTHER" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await getVoucher(w.manager, first.voucher.id)).id).toBe(first.voucher.id);
    await expect(getVoucher(w.admin, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      deleteContract(w.admin, w.contract.id, {
        reasonId: await optionId("deleteReasons", "Khác"),
        reasonNote: "Sai",
      }),
    ).rejects.toMatchObject({
      code: "CONTRACT_HAS_DEPENDENTS",
      dependents: expect.arrayContaining([expect.objectContaining({ kind: "voucher" })]),
    });
  });
});

describe("a hold (brief §5.6)", () => {
  it("moves the end date by the days held and cancels the sessions booked inside it", async () => {
    const w = await world();
    const before = await getContract(w.admin, w.contract.id);
    const inside = await book(w.manager, w, { date: "15/10/2026" });
    const outside = await book(w.manager, w, { date: "22/10/2026" });
    const { voucher } = await raiseHold(
      w.manager,
      { contractId: w.contract.id, fromDate: "12/10/2026", toDate: "20/10/2026", note: "Đi công tác" },
      randomUUID(),
    );
    expect(voucher).toMatchObject({ kind: "HOLD", status: "PENDING", days: 9, sessionsDelta: 0 });
    // Waiting has no effect: the session is still booked and the contract is not on hold.
    expect((await getContract(w.admin, w.contract.id)).onHold).toBeNull();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: inside.id } })).status).toBe("BOOKED");

    // The customer has an address, so the optional hold email is queued.
    await prisma.customer.update({ where: { id: w.customer.id }, data: { email: "an@example.test" } });
    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    const after = await getContract(w.admin, w.contract.id);
    expect(iso(after.endDate)).toBe(iso(new Date(before.endDate.getTime() + 9 * 86_400_000)));
    expect(after.onHold).toMatchObject({ voucherNumber: voucher.voucherNumber });
    expect(iso(after.onHold!.fromDate)).toBe("2026-10-12");
    expect(after).toMatchObject({ voucherSessions: 0, voucherValue: 0, remainingSessions: before.remainingSessions });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: inside.id } })).status).toBe("CANCELLED");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: outside.id } })).status).toBe("BOOKED");
    const cancelled = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: inside.id, action: "booking.cancelled" },
    });
    expect(cancelled.metadata).toMatchObject({ reason: "contract.hold" });
    // The customer is told (the hold email is optional and on by default).
    expect(await prisma.emailMessage.count({ where: { event: "change.hold" } })).toBe(1);
    const approved = await getVoucher(w.admin, voucher.id);
    expect(approved.endDateAfter && iso(approved.endDateAfter)).toBe(iso(after.endDate));
  });

  it("refuses a booking, a reschedule and a class seat on a day inside the hold", async () => {
    const w = await world();
    const trainer2 = await createTrainer(w.manager, { fullName: "PT Hoa" });
    const later = await book(w.manager, w, { date: "25/10/2026" });
    const { voucher } = await raiseHold(
      w.manager,
      { contractId: w.contract.id, fromDate: "12/10/2026", toDate: "20/10/2026" },
      randomUUID(),
    );
    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    await expect(book(w.manager, w, { date: "15/10/2026" })).rejects.toMatchObject({ code: "CONTRACT_ON_HOLD" });
    await expect(book(w.manager, w, { date: "12/10/2026" }, trainer2.id)).rejects.toMatchObject({
      code: "CONTRACT_ON_HOLD",
    });
    // The first and the last day are inside; the day after is not.
    await expect(book(w.manager, w, { date: "20/10/2026" })).rejects.toMatchObject({ code: "CONTRACT_ON_HOLD" });
    await book(w.manager, w, { date: "21/10/2026" });
    expect(later.id).toBeDefined();
    expect(await cancelBooking(w.manager, later.id)).toMatchObject({ status: "CANCELLED" });
    void createBooking;
  });

  it("is refused for overlapping days, days outside the contract, a trained session inside, and a wrong range", async () => {
    const w = await world();
    const hold = (fromDate: string, toDate: string) =>
      raiseHold(w.manager, { contractId: w.contract.id, fromDate, toDate }, randomUUID());
    await hold("12/10/2026", "20/10/2026");
    // A hold waiting counts as much as an approved one.
    await expect(hold("20/10/2026", "25/10/2026")).rejects.toMatchObject({
      fieldErrors: { fromDate: ["overlapsHold"] },
    });
    await hold("21/10/2026", "22/10/2026");
    await expect(hold("01/09/2026", "05/09/2026")).rejects.toMatchObject({
      fieldErrors: { fromDate: ["outsideContract"] },
    });
    await expect(hold("20/10/2026", "12/10/2026")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(hold("", "12/10/2026")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const trained = await book(w.manager, w, { date: "05/10/2026" });
    await completeSession(w.admin, trained.id);
    await expect(hold("04/10/2026", "06/10/2026")).rejects.toMatchObject({
      fieldErrors: { fromDate: ["hasTrainedSessions"] },
    });
  });

  it("is the approved days only that block: a rejected hold blocks nothing", async () => {
    const w = await world();
    const { voucher } = await raiseHold(
      w.manager,
      { contractId: w.contract.id, fromDate: "12/10/2026", toDate: "20/10/2026" },
      randomUUID(),
    );
    await rejectRequest(w.admin, (await pendingOf(voucher.id)).id, {
      reasonId: await optionId("rejectReasons", "Khác"),
      reasonNote: "Không hợp lệ",
    });
    await book(w.manager, w, { date: "15/10/2026" });
    await raiseHold(
      w.manager,
      { contractId: w.contract.id, fromDate: "16/10/2026", toDate: "17/10/2026" },
      randomUUID(),
    );
  });
});
