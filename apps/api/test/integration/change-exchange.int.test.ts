import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { approveRequest, rejectRequest } from "../../src/modules/approvals/approval.service.js";
import { getVoucher, raiseConversion, raiseUpgrade, raiseRenewal } from "../../src/modules/changes/voucher.service.js";
import { getContract } from "../../src/modules/contracts/contract.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { book, bookingScenario, testService } from "../support/bookings.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId, withoutApprovals } from "../support/factories.js";

afterEach(resetDatabase);

// Upgrade and conversion (M8.2; brief §5.6; FR-CHG-001; D-024, D-018, T-050; A-227 to A-231).

async function world() {
  const scenario = await bookingScenario({ sessions: 24 });
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const target = await testService(60, 800_000, "PT cao cấp");
  return { ...scenario, admin, target };
}
type World = Awaited<ReturnType<typeof world>>;

const pendingOf = (voucherId: string) =>
  prisma.approvalRequest.findFirstOrThrow({ where: { entityType: "voucher", entityId: voucherId, status: "PENDING" } });

const input = (w: World, patch: Record<string, unknown> = {}) => ({
  contractId: w.contract.id,
  targetServiceId: w.target.id,
  sessions: 12,
  amount: 9_600_000,
  credit: 4_000_000,
  ...patch,
});

describe("an upgrade (brief §5.6)", () => {
  it("waits with no effect, then makes the sessions left the new package's and adds the price less the credit", async () => {
    const w = await world();
    const before = await getContract(w.admin, w.contract.id);
    const { voucher } = await raiseUpgrade(w.manager, input(w), randomUUID());
    expect(voucher).toMatchObject({
      kind: "UPGRADE",
      status: "PENDING",
      targetService: { id: w.target.id, name: "PT cao cấp" },
      sessions: 12,
      amount: 9_600_000,
      credit: 4_000_000,
      sessionsDelta: 0,
      valueDelta: 0,
    });
    expect(await getContract(w.admin, w.contract.id)).toMatchObject({ voucherSessions: 0, voucherValue: 0 });

    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    const approved = await getVoucher(w.admin, voucher.id);
    // 24 left, 12 asked for: 12 fewer; 9.6m less 4m credited: 5.6m more.
    expect(approved).toMatchObject({ status: "APPROVED", sessionsDelta: -12, valueDelta: 5_600_000 });
    const after = await getContract(w.admin, w.contract.id);
    expect(after).toMatchObject({
      remainingSessions: 12,
      contractValue: before.contractValue + 5_600_000,
      debt: before.debt + 5_600_000,
    });
    const history = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "contract", entityId: w.contract.id, action: "contract.upgraded_by_voucher" },
    });
    expect(history.metadata).toMatchObject({ voucherNumber: voucher.voucherNumber, sessionsDelta: -12 });
  });

  it("counts what is left when it is approved, not when it was raised", async () => {
    const w = await world();
    await withoutApprovals();
    await book(w.manager, w, { date: "15/10/2026" });
    await prisma.approvalRule.updateMany({
      where: { actionType: { startsWith: "voucher." } },
      data: { required: true },
    });
    const { voucher } = await raiseUpgrade(w.manager, input(w, { sessions: 30 }), randomUUID());
    // A renewal approved in between adds 6 sessions before the upgrade is decided.
    const renewal = await raiseRenewal(w.manager, { contractId: w.contract.id, sessions: 6 }, randomUUID());
    await approveRequest(w.admin, (await pendingOf(renewal.voucher.id)).id);
    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    // Nothing was used (a booked session is not used): 30 left in the end.
    expect((await getVoucher(w.admin, voucher.id)).sessionsDelta).toBe(0);
    expect((await getContract(w.admin, w.contract.id)).remainingSessions).toBe(30);
  });

  it("tells the customer, always, with the new service and the sessions left", async () => {
    const w = await world();
    const { voucher } = await raiseUpgrade(w.manager, input(w), randomUUID());
    await approveRequest(w.admin, (await pendingOf(voucher.id)).id);
    const emails = await prisma.emailMessage.findMany({ where: { event: "change.upgrade" } });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ personId: w.customer.id, status: "FAILED" });
    expect(emails[0]!.body).toContain("PT cao cấp");
    expect(emails[0]!.body).toContain("còn lại: 12");
  });

  it("is rejected without any effect, and the submitter cannot approve it", async () => {
    const w = await world();
    const { voucher } = await raiseUpgrade(w.manager, input(w), randomUUID());
    const request = await pendingOf(voucher.id);
    await expect(approveRequest(w.manager, request.id)).rejects.toMatchObject({ code: "APPROVAL_OWN_REQUEST" });
    await rejectRequest(w.admin, request.id, {
      reasonId: await optionId("rejectReasons", "Khác"),
      reasonNote: "Không phù hợp",
    });
    expect(await getVoucher(w.admin, voucher.id)).toMatchObject({ status: "REJECTED", sessionsDelta: 0 });
    expect((await getContract(w.admin, w.contract.id)).voucherSessions).toBe(0);
  });

  it("acts at once when the matrix does not ask for approval, and replays with the same key", async () => {
    const w = await world();
    await prisma.approvalRule.update({ where: { actionType: "voucher.upgrade" }, data: { required: false } });
    const key = randomUUID();
    const first = await raiseUpgrade(w.manager, input(w), key);
    expect(first.voucher.status).toBe("APPROVED");
    const again = await raiseUpgrade(w.manager, input(w), key);
    expect(again.replayed).toBe(true);
    expect(again.voucher.id).toBe(first.voucher.id);
    await expect(raiseUpgrade(w.manager, input(w, { sessions: 13 }), key)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect((await getContract(w.admin, w.contract.id)).remainingSessions).toBe(12);
  });

  it("is refused for a bad service, a credit above the price or the value, and bad numbers", async () => {
    const w = await world();
    const refused = (patch: Record<string, unknown>) => raiseUpgrade(w.manager, input(w, patch), randomUUID());
    await expect(refused({ targetServiceId: randomUUID() })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { targetServiceId: ["invalidChoice"] },
    });
    await expect(refused({ credit: 9_600_001 })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { credit: ["creditAboveAmount"] },
    });
    // 24 sessions at 500,000 is worth 12,000,000.
    await expect(refused({ amount: 20_000_000, credit: 12_000_001 })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { credit: ["creditAboveValue"] },
    });
    for (const bad of [
      { sessions: 0 },
      { sessions: 1001 },
      { amount: -1 },
      { note: "a\u0007b" },
      { targetServiceId: "x" },
    ]) {
      await expect(refused(bad), JSON.stringify(bad)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    // A service that is not on sale in the contract's branch is not a choice.
    await prisma.service.update({ where: { id: w.target.id }, data: { active: false } });
    await expect(refused({})).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("is refused for a contract that is frozen, ended or someone else's", async () => {
    const w = await world();
    await prisma.contract.update({ where: { id: w.contract.id }, data: { status: "FROZEN" } });
    await expect(raiseUpgrade(w.manager, input(w), randomUUID())).rejects.toMatchObject({ code: "CONTRACT_FROZEN" });
    await prisma.contract.update({ where: { id: w.contract.id }, data: { status: "CANCELLED" } });
    await expect(raiseUpgrade(w.manager, input(w), randomUUID())).rejects.toMatchObject({
      code: "CONTRACT_NOT_ACTIVE",
    });
    await expect(raiseUpgrade(w.manager, input(w, { contractId: randomUUID() }), randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("a conversion (brief §5.6)", () => {
  it("has its own kind, approval action and email, and the same effect as an upgrade", async () => {
    const w = await world();
    const { voucher } = await raiseConversion(w.manager, input(w, { credit: 9_600_000 }), randomUUID());
    expect(voucher).toMatchObject({ kind: "CONVERSION", status: "PENDING" });
    const request = await pendingOf(voucher.id);
    expect(request.actionType).toBe("voucher.conversion");
    await approveRequest(w.admin, request.id);
    expect(await getVoucher(w.admin, voucher.id)).toMatchObject({ sessionsDelta: -12, valueDelta: 0 });
    expect(await prisma.emailMessage.count({ where: { event: "change.conversion" } })).toBe(1);
    expect((await getContract(w.admin, w.contract.id)).remainingSessions).toBe(12);
  });
});
