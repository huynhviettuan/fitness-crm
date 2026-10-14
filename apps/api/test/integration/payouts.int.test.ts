import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { deleteCashTransaction } from "../../src/modules/finance/cash.service.js";
import { updateService } from "../../src/modules/services/service.service.js";
import { completeSession } from "../../src/modules/sessions/session.service.js";
import { burnShow, deleteTrainedSession } from "../../src/modules/sessions/session-history.service.js";
import { createPayout, getPayout, listPayouts } from "../../src/modules/payouts/payout.service.js";
import { ptRevenueReport } from "../../src/modules/reports/pt-report.service.js";
import { resetDatabase } from "../support/database.js";
import {
  DEFAULT_BRANCH_ID,
  createTestBranch,
  createTestOption,
  createTestUser,
  optionId,
  roleId,
  withoutApprovals,
  type RoleCode,
} from "../support/factories.js";
import { activeContract, book, bookingScenario, type Scenario } from "../support/bookings.js";

afterEach(resetDatabase);
beforeEach(withoutApprovals);

// PT payouts (M5.7; brief §6.3, §8.1; D-018, D-027, D-032; FR-CASH-003; INT-011; A-173 to A-176).

const OCTOBER = { from: "01/10/2026", to: "31/10/2026" };
const NOVEMBER = { from: "01/11/2026", to: "30/11/2026" };
const OTHER_DELETE = await optionId("deleteReasons", "Khác");
const BURN_REASON = await optionId("burnShowReasons", "Khôi phục buổi tập xóa nhầm");
const CASH = await optionId("paymentMethods", "Tiền mặt");

const key = () => randomUUID();

async function setup() {
  const scenario = await bookingScenario();
  const { actor: root } = await createTestUser("ADMIN", { allBranches: true });
  const category = await createTestOption("expenseTypes", "Chi lương PT");
  return { ...scenario, root, category };
}
type World = Awaited<ReturnType<typeof setup>>;

const slot = (date: string) => ({ date, startTime: "09:00", endTime: "10:00" });

/** Books a session of the scenario and completes it: it credits the PT with one session of 500,000. */
async function train(world: World, date: string) {
  const booking = await book(world.manager, world as unknown as Scenario, slot(date));
  await completeSession(world.root, booking.id);
  return booking;
}

const input = (world: World, period = OCTOBER, overrides: Record<string, unknown> = {}) => ({
  trainerId: world.trainer.id,
  ...period,
  categoryId: world.category,
  methodId: CASH,
  ...overrides,
});
const pay = (world: World, period = OCTOBER, overrides: Record<string, unknown> = {}, actor = world.root) =>
  createPayout(actor, input(world, period, overrides), key());

const liveLines = (kind?: string) =>
  prisma.ptPayoutLine.findMany({ where: { releasedAt: null, ...(kind ? { kind } : {}) } });

describe("paying a PT (FR-CASH-003, D-032)", () => {
  it("pays the unpaid sessions of the period with one expense voucher, and says what it paid", async () => {
    const world = await setup();
    await train(world, "05/10/2026");
    await train(world, "06/10/2026");
    await train(world, "07/10/2026");
    await train(world, "03/11/2026");

    const { payout, replayed } = await pay(world);

    expect(replayed).toBe(false);
    expect(payout).toMatchObject({
      amount: 1_500_000,
      sessionAmount: 1_500_000,
      adjustmentAmount: 0,
      sessionCount: 3,
      adjustmentCount: 0,
      approvalStatus: "APPROVED",
      void: false,
      trainer: { id: world.trainer.id },
    });
    expect(payout.lines).toHaveLength(3);
    expect(payout.lines.every((line) => line.kind === "SESSION" && line.amount === 500_000)).toBe(true);
    const voucher = await prisma.cashTransaction.findUniqueOrThrow({ where: { number: payout.number } });
    expect(voucher).toMatchObject({
      type: "EXPENSE",
      payee: "PT Minh",
      categoryId: world.category,
      methodId: CASH,
      branchId: DEFAULT_BRANCH_ID,
    });
    expect(Number(voucher.amount)).toBe(1_500_000);
    expect(
      await prisma.auditEvent.findFirst({ where: { entityId: payout.id, action: "pt_payout.created" } }),
    ).toMatchObject({
      actorUserId: world.root.id,
    });

    // The report knows what is paid.
    const [trainer] = (await ptRevenueReport(world.root, OCTOBER)).trainers;
    expect(trainer).toMatchObject({ credited: 3, allocation: 1_500_000, payable: 0, adjustments: 0 });
    expect(trainer!.rows[0]).toMatchObject({ paidSessions: 3, payable: 0 });
    // November's session is not in October's payout.
    expect((await ptRevenueReport(world.root, NOVEMBER)).trainers[0]).toMatchObject({ payable: 500_000 });
  });

  it("never pays a session twice: the same period again has nothing to pay, a later session is paid alone", async () => {
    const world = await setup();
    await train(world, "05/10/2026");
    await train(world, "06/10/2026");
    await pay(world);

    await expect(pay(world)).rejects.toMatchObject({ code: "PAYOUT_NOTHING_TO_PAY" });

    // A Burn Show added to the paid period afterwards is the only thing the next payout pays (D-028).
    await burnShow(world.root, {
      contractId: world.contract.id,
      trainerId: world.trainer.id,
      date: "08/10/2026",
      startTime: "09:00",
      endTime: "10:00",
      reasonId: BURN_REASON,
    });
    const { payout } = await pay(world, { from: "01/10/2026", to: "15/10/2026" });
    expect(payout).toMatchObject({ amount: 500_000, sessionCount: 1 });
    expect(await liveLines("SESSION")).toHaveLength(3);
    await expect(pay(world)).rejects.toMatchObject({ code: "PAYOUT_NOTHING_TO_PAY" });
  });

  it("pays no session twice under concurrent payouts of the same PT and period (INT-011)", async () => {
    const world = await setup();
    await train(world, "05/10/2026");
    await train(world, "06/10/2026");
    await train(world, "07/10/2026");

    const results = await Promise.allSettled(Array.from({ length: 6 }, () => pay(world)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "PAYOUT_NOTHING_TO_PAY" });
    }
    expect(await liveLines("SESSION")).toHaveLength(3);
    expect(await prisma.ptPayout.count()).toBe(1);
    expect(await prisma.cashTransaction.count({ where: { type: "EXPENSE" } })).toBe(1);
  });

  it("replays a repeated request and refuses a reused key (T-015)", async () => {
    const world = await setup();
    await train(world, "05/10/2026");
    const idempotencyKey = key();
    const first = await createPayout(world.root, input(world), idempotencyKey);

    const again = await createPayout(world.root, input(world), idempotencyKey);
    const racing = await Promise.all(
      Array.from({ length: 4 }, () => createPayout(world.root, input(world), idempotencyKey)),
    );

    expect(again).toMatchObject({ replayed: true, payout: { id: first.payout.id } });
    expect(racing.every((result) => result.payout.id === first.payout.id)).toBe(true);
    expect(await prisma.ptPayout.count()).toBe(1);
    await expect(createPayout(world.root, input(world, NOVEMBER), idempotencyKey)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    await expect(createPayout(world.root, input(world), undefined)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  });

  it("applies the service's commission rate and the timesheet rate, as the report does", async () => {
    const world = await setup();
    await train(world, "05/10/2026");
    await train(world, "06/10/2026");
    const service = await prisma.service.findFirstOrThrow({
      where: { contracts: { some: { id: world.contract.id } } },
    });
    await updateService(world.root, service.id, {
      name: service.name,
      kind: service.kind,
      branchIds: [DEFAULT_BRANCH_ID],
      commissionRate: 50,
    });

    const [before] = (await ptRevenueReport(world.root, OCTOBER)).trainers;
    const { payout } = await pay(world);

    // 2 sessions × 500,000 × 50%
    expect(payout.amount).toBe(500_000);
    expect(before!.payable).toBe(500_000);
  });
});

describe("adjustments for paid sessions that were deleted (D-027)", () => {
  it("takes the session back in the PT's next payout, once: 'minus 1 session, deleted session of 20/10'", async () => {
    const world = await setup();
    await train(world, "05/10/2026");
    const mistaken = await train(world, "20/10/2026");
    await pay(world);

    // The paid period is closed, but the session can still be deleted: the payout stands, and an adjustment waits.
    await deleteTrainedSession(world.root, mistaken.id, { reasonId: OTHER_DELETE, reasonNote: "Ghi nhầm" });
    const [pending] = (await ptRevenueReport(world.root, OCTOBER)).trainers;
    expect(pending).toMatchObject({ credited: 1, adjustments: -500_000, payable: -500_000 });
    expect(pending!.rows[0]).toMatchObject({ adjustments: -500_000 });
    expect(await prisma.ptPayout.findFirstOrThrow({}).then((payout) => Number(payout.amount))).toBe(1_000_000);

    // Nothing but the adjustment: there is no money to pay.
    await expect(pay(world, NOVEMBER)).rejects.toMatchObject({ code: "PAYOUT_NOTHING_TO_PAY" });

    await train(world, "03/11/2026");
    await train(world, "04/11/2026");
    const { payout } = await pay(world, NOVEMBER);

    expect(payout).toMatchObject({
      amount: 500_000,
      sessionAmount: 1_000_000,
      adjustmentAmount: -500_000,
      sessionCount: 2,
      adjustmentCount: 1,
    });
    const adjustment = payout.lines.find((line) => line.kind === "ADJUSTMENT");
    expect(adjustment).toMatchObject({ amount: -500_000, booking: { id: mistaken.id } });
    expect(await ptRevenueReport(world.root, NOVEMBER)).toMatchObject({
      totals: { payable: 0, adjustments: 0 },
    });
    // Taken back once only.
    expect(await liveLines("ADJUSTMENT")).toHaveLength(1);
    await expect(pay(world, NOVEMBER)).rejects.toMatchObject({ code: "PAYOUT_NOTHING_TO_PAY" });
  });

  it("takes back exactly what the session was paid, whatever the rounding of its contract", async () => {
    const world = await setup();
    // 7 sessions at 100,001 and a commission of 50%: 3 sessions are 150,001.5, paid as 150,002 = 50,001 + 50,001 + 50,000.
    const odd = await activeContract(
      world.manager,
      world.customer.id,
      { sessions: 7 },
      { unitPrice: 100_001, name: "PT odd" },
    );
    const service = await prisma.service.findUniqueOrThrow({ where: { name: "PT odd" } });
    await updateService(world.root, service.id, {
      name: service.name,
      kind: service.kind,
      branchIds: [DEFAULT_BRANCH_ID],
      commissionRate: 50,
    });
    const oddWorld = { ...world, contract: odd } as World;
    const first = await train(oddWorld, "05/10/2026");
    await train(oddWorld, "06/10/2026");
    await train(oddWorld, "07/10/2026");
    const { payout } = await pay(world);
    expect(payout.amount).toBe(150_002);
    const paid = payout.lines.find((line) => line.booking.id === first.id)!.amount;
    expect(paid).toBe(50_001);

    await deleteTrainedSession(world.root, first.id, { reasonId: OTHER_DELETE, reasonNote: "Ghi nhầm" });

    expect((await ptRevenueReport(world.root, OCTOBER)).totals.adjustments).toBe(-paid);
  });

  it("is not owed when the session was never paid", async () => {
    const world = await setup();
    const unpaid = await train(world, "05/10/2026");
    await deleteTrainedSession(world.root, unpaid.id, { reasonId: OTHER_DELETE, reasonNote: "Ghi nhầm" });

    expect((await ptRevenueReport(world.root, OCTOBER)).trainers).toEqual([]);
    await expect(pay(world)).rejects.toMatchObject({ code: "PAYOUT_NOTHING_TO_PAY" });
  });
});

describe("a payout that stops standing", () => {
  it("lets its sessions and its adjustments go when the voucher is deleted", async () => {
    const world = await setup();
    await train(world, "05/10/2026");
    const mistaken = await train(world, "06/10/2026");
    const first = await pay(world);
    await deleteTrainedSession(world.root, mistaken.id, { reasonId: OTHER_DELETE, reasonNote: "Ghi nhầm" });
    await train(world, "03/11/2026");
    await train(world, "04/11/2026");
    const second = await pay(world, NOVEMBER);
    expect(second.payout.adjustmentCount).toBe(1);

    // November's voucher is deleted: its sessions are payable again and the adjustment is pending again.
    const voucher = await prisma.cashTransaction.findUniqueOrThrow({ where: { number: second.payout.number } });
    await deleteCashTransaction(world.root, voucher.id, { reasonId: OTHER_DELETE, reasonNote: "Nhập nhầm" });

    expect((await getPayout(world.root, second.payout.id)).void).toBe(true);
    expect((await getPayout(world.root, first.payout.id)).void).toBe(false);
    expect((await ptRevenueReport(world.root, NOVEMBER)).trainers[0]).toMatchObject({
      payable: 500_000,
      adjustments: -500_000,
    });
    const again = await pay(world, NOVEMBER);
    expect(again.payout).toMatchObject({ amount: 500_000, sessionCount: 2, adjustmentCount: 1 });
    expect(await liveLines("ADJUSTMENT")).toHaveLength(1);

    // October's voucher is deleted too: both of its sessions are payable again.
    const october = await prisma.cashTransaction.findUniqueOrThrow({ where: { number: first.payout.number } });
    await deleteCashTransaction(world.root, october.id, { reasonId: OTHER_DELETE, reasonNote: "Nhập nhầm" });
    expect((await ptRevenueReport(world.root, OCTOBER)).trainers[0]).toMatchObject({ payable: 500_000 });
  });

  it("holds its sessions while the voucher waits for approval, and lets them go when it is rejected (D-018)", async () => {
    const world = await setup();
    await train(world, "05/10/2026");
    await prisma.approvalRule.updateMany({ where: { actionType: "cash.create" }, data: { required: true } });

    const { payout } = await pay(world);
    expect(payout.approvalStatus).toBe("PENDING");
    await expect(pay(world)).rejects.toMatchObject({ code: "PAYOUT_NOTHING_TO_PAY" });

    await prisma.cashTransaction.update({ where: { number: payout.number }, data: { approvalStatus: "REJECTED" } });

    expect((await getPayout(world.root, payout.id)).void).toBe(true);
    expect((await pay(world)).payout.amount).toBe(500_000);
  });
});

describe("who may pay and see payouts", () => {
  it("is for admin, the manager and the accountant, and the list and detail follow the branch", async () => {
    const world = await setup();
    await train(world, "05/10/2026");
    const { payout } = await pay(world);

    for (const role of ["FITNESS_MANAGER", "ACCOUNTANT"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      expect((await listPayouts(actor, {})).total).toBe(1);
      expect((await getPayout(actor, payout.id)).id).toBe(payout.id);
    }
    for (const role of ["PT", "RECEPTIONIST", "CONSULTING", "MARKETING"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      await expect(listPayouts(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(pay(world, OCTOBER, {}, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const other = await createTestBranch();
    const { actor: elsewhere } = await createTestUser("ADMIN", { branchIds: [other.id] });
    expect((await listPayouts(elsewhere, {})).total).toBe(0);
    await expect(getPayout(elsewhere, payout.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pay(world, OCTOBER, {}, elsewhere)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("is refused to a role with own scope or with receipt totals hidden", async () => {
    const world = await setup();
    await train(world, "05/10/2026");
    const source = await prisma.role.findUniqueOrThrow({
      where: { id: await roleId("ADMIN") },
      include: { permissions: true, dataScopes: true },
    });
    for (const variant of ["scope", "mask"] as const) {
      const copy = await prisma.role.create({
        data: {
          name: `Admin ${randomUUID().slice(0, 8)}`,
          permissions: { create: source.permissions.map((p) => ({ permission: p.permission })) },
          dataScopes: {
            create: source.dataScopes.map((s) => ({
              resource: s.resource,
              scope: variant === "scope" && s.resource === "vouchers" ? "OWN" : s.scope,
            })),
          },
          fieldMasks: { create: variant === "mask" ? [{ field: "receipts.totals" }] : [] },
        },
      });
      const { actor } = await createTestUser("ADMIN", { allBranches: true, roleId: copy.id });
      await expect(pay(world, OCTOBER, {}, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(listPayouts(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await prisma.ptPayout.count()).toBe(0);
  });

  it("refuses bad input, and never takes an amount from the request", async () => {
    const world = await setup();
    await train(world, "05/10/2026");

    await expect(pay(world, OCTOBER, { trainerId: randomUUID() })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(pay(world, OCTOBER, { trainerId: "nope" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(pay(world, { from: "10/10/2026", to: "01/10/2026" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    // The category must come from the list of expense types.
    await expect(pay(world, OCTOBER, { categoryId: OTHER_DELETE })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(getPayout(world.root, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { payout } = await pay(world, OCTOBER, { amount: "999999999" });
    expect(payout.amount).toBe(500_000);
  });

  it("lists payouts by PT and period, newest first", async () => {
    const world = await setup();
    await train(world, "05/10/2026");
    const first = await pay(world);
    await train(world, "03/11/2026");
    const second = await pay(world, NOVEMBER);

    const all = await listPayouts(world.root, {});
    expect(all.items.map((item) => item.id)).toEqual([second.payout.id, first.payout.id]);
    expect((await listPayouts(world.root, { from: "01/11/2026" })).items.map((item) => item.id)).toEqual([
      second.payout.id,
    ]);
    expect((await listPayouts(world.root, { trainerId: randomUUID() })).total).toBe(0);
  });
});
