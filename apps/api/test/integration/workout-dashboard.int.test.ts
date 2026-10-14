import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { approveRequest } from "../../src/modules/approvals/approval.service.js";
import { createArea, createExercise, createStage } from "../../src/modules/workouts/catalog.service.js";
import { workoutDashboard, workoutDrill } from "../../src/modules/workouts/dashboard.service.js";
import { markSeen } from "../../src/modules/workouts/escalation.service.js";
import { createLog, getLog, updateLog } from "../../src/modules/workouts/log.service.js";
import { createPlan, submitPlan, updatePlan } from "../../src/modules/workouts/plan.service.js";
import { getProgress } from "../../src/modules/workouts/progress.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { resetDatabase } from "../support/database.js";
import { createTestBranch, createTestUser, optionId, type RoleCode } from "../support/factories.js";
import { book, bookingScenario, linkedTrainer } from "../support/bookings.js";

afterEach(resetDatabase);

// The weekly workout dashboard and a customer's progress (M7.5; brief §7.5, §9; FR-WKO-005; AC-20, AC-21; A-212 to A-217).

async function world() {
  const first = await bookingScenario({ fullName: "Nguyễn Văn An", phone: "0909123456" });
  const second = await bookingScenario({ fullName: "Lê Thị Bình", phone: "0909000111" });
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const { actor: master } = await createTestUser("MASTER", { allBranches: true });
  const area = await createArea(admin, { code: "LOW", name: "Thân dưới" });
  const squat = await createExercise(admin, { name: "Squat", areaId: area.id, kind: "STRENGTH" });
  const run = await createExercise(admin, { name: "Chạy bộ", areaId: area.id, kind: "CARDIO" });
  const flags = {
    normal: await optionId("workoutFlags", "Normal"),
    stress: await optionId("workoutFlags", "Stress"),
    overload: await optionId("workoutFlags", "Overload"),
    pattern: await optionId("workoutFlags", "Pattern"),
  };
  const actions = {
    none: await optionId("workoutActions", "None"),
    reduce: await optionId("workoutActions", "Giảm tải"),
    stop: await optionId("workoutActions", "Dừng + Escalation"),
  };
  return { first, second, admin, master, squat, run, flags, actions };
}
type World = Awaited<ReturnType<typeof world>>;
type Sets = [string, string][];

/** A log of the customer's session on `date`: one Squat with a set for each [flag, action], 40 kg × 5 each. */
async function logOn(w: World, who: World["first"], date: string, sets: Sets, extra: Record<string, unknown> = {}) {
  const booking = await book(w.admin, who, { date }, who.trainer.id);
  const log = await createLog(w.admin, { bookingId: booking.id });
  return updateLog(w.admin, log.id, {
    ...extra,
    items: [
      {
        exerciseId: w.squat.id,
        sets: sets.map(([flagId, actionId]) => ({ weight: "40", reps: "5", flagId, actionId })),
      },
    ],
  });
}

/** The fixed dataset: week of 12/10/2026 has 8 sets in 3 sessions of 2 customers; the week before has 4 sets in 1. */
async function dataset(w: World) {
  const { normal, stress, overload, pattern } = w.flags;
  const { none, reduce, stop } = w.actions;
  await logOn(w, w.first, "13/10/2026", [
    [normal, none],
    [normal, none],
    [stress, reduce],
    [overload, none],
  ]);
  await logOn(w, w.first, "16/10/2026", [
    [normal, none],
    [normal, none],
  ]);
  await logOn(w, w.second, "14/10/2026", [
    [normal, none],
    [pattern, stop],
  ]);
  await logOn(w, w.first, "06/10/2026", [
    [normal, none],
    [normal, none],
    [normal, none],
    [normal, none],
  ]);
}

const by = <T extends { option: { code: string | null } }>(rows: T[], code: string) =>
  rows.find((row) => row.option.code === code)!;

describe("the weekly dashboard (brief §9, AC-21)", () => {
  it("gives the shares of each Flag and Action over the sets of the week, and the week before", async () => {
    const w = await world();
    await dataset(w);
    const dashboard = await workoutDashboard(w.master, { week: "15/10/2026" });

    expect(dashboard.totals).toEqual({
      sets: 8,
      sessions: 3,
      customers: 2,
      previousSets: 4,
      previousSessions: 1,
      previousCustomers: 1,
    });
    expect(by(dashboard.flags, "NORMAL")).toMatchObject({
      sets: 5,
      percent: 62.5,
      previousSets: 4,
      previousPercent: 100,
    });
    expect(by(dashboard.flags, "STRESS")).toMatchObject({
      sets: 1,
      percent: 12.5,
      previousSets: 0,
      previousPercent: 0,
    });
    expect(by(dashboard.flags, "OVERLOAD")).toMatchObject({ sets: 1, percent: 12.5 });
    expect(by(dashboard.flags, "PATTERN")).toMatchObject({ sets: 1, percent: 12.5 });
    expect(by(dashboard.flags, "SPIKE_NEURO")).toMatchObject({ sets: 0, percent: 0 });
    expect(by(dashboard.actions, "NONE")).toMatchObject({
      sets: 6,
      percent: 75,
      previousSets: 4,
      previousPercent: 100,
    });
    expect(by(dashboard.actions, "REDUCE")).toMatchObject({ sets: 1, percent: 12.5 });
    expect(by(dashboard.actions, "STOP_ESCALATION")).toMatchObject({ sets: 1, percent: 12.5 });
    // The shares of the week add up to everything recorded.
    expect(dashboard.flags.reduce((sum, row) => sum + row.sets, 0)).toBe(8);
    expect(dashboard.actions.reduce((sum, row) => sum + row.sets, 0)).toBe(8);
    expect(dashboard).toMatchObject({ nonNormalCustomers: 2, previousNonNormalCustomers: 0, openEscalations: 1 });

    // Any day of the week gives the same week; the week before shows its own figures.
    expect((await workoutDashboard(w.master, { week: "12/10/2026" })).totals.sets).toBe(8);
    expect((await workoutDashboard(w.master, { week: "18/10/2026" })).totals.sets).toBe(8);
    const before = await workoutDashboard(w.master, { week: "08/10/2026" });
    expect(before.totals).toMatchObject({ sets: 4, sessions: 1, customers: 1, previousSets: 0 });
    expect(by(before.flags, "NORMAL")).toMatchObject({ percent: 100, previousPercent: 0 });
    expect(before).toMatchObject({ nonNormalCustomers: 0, openEscalations: 1 });
    // An empty week has no shares to divide by.
    const empty = await workoutDashboard(w.master, { week: "01/02/2026" });
    expect(empty.totals.sets).toBe(0);
    expect(empty.flags.every((row) => row.percent === 0)).toBe(true);

    // The escalation leaves the count when it is marked seen.
    const waiting = await prisma.workoutEscalation.findFirstOrThrow();
    await markSeen(w.master, waiting.id, { direction: "Theo dõi" });
    expect((await workoutDashboard(w.master, { week: "15/10/2026" })).openEscalations).toBe(0);
  });

  it("opens the sets behind a share, newest session first", async () => {
    const w = await world();
    await dataset(w);
    const query = { week: "15/10/2026" };

    const stress = await workoutDrill(w.master, { ...query, kind: "flag", optionId: w.flags.stress });
    expect(stress.total).toBe(1);
    expect(stress.items[0]).toMatchObject({
      customer: { fullName: "Nguyễn Văn An" },
      exercise: "Squat",
      setNo: 3,
      flag: { id: w.flags.stress },
      action: { id: w.actions.reduce },
    });

    const stop = await workoutDrill(w.master, { ...query, kind: "action", optionId: w.actions.stop });
    expect(stop.items.map((row) => row.customer.fullName)).toEqual(["Lê Thị Bình"]);

    const other = await workoutDrill(w.master, { ...query, kind: "nonNormal" });
    expect(other.total).toBe(3);
    expect(other.items.map((row) => row.flag.code)).toEqual(["PATTERN", "STRESS", "OVERLOAD"]);
    expect(
      (await workoutDrill(w.master, { ...query, kind: "nonNormal", pageSize: "2", page: "2" })).items,
    ).toHaveLength(1);
    // The previous week's sets are not in it.
    expect((await workoutDrill(w.master, { week: "08/10/2026", kind: "nonNormal" })).total).toBe(0);
    expect(by(await (async () => (await workoutDashboard(w.master, query)).flags)(), "NORMAL").sets).toBe(
      (await workoutDrill(w.master, { ...query, kind: "flag", optionId: w.flags.normal })).total,
    );
  });

  it("is for Admin, the manager and the Master, in their branches, with bad inputs refused", async () => {
    const w = await world();
    await dataset(w);
    expect((await workoutDashboard(w.admin, { week: "15/10/2026" })).totals.sets).toBe(8);
    expect((await workoutDashboard(w.first.manager, { week: "15/10/2026" })).totals.sets).toBe(8);
    for (const role of ["RECEPTIONIST", "CONSULTING", "ACCOUNTANT", "PT", "MARKETING"] as RoleCode[]) {
      const { actor } = await createTestUser(role, { allBranches: true });
      await expect(workoutDashboard(actor, {}), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(workoutDrill(actor, { kind: "nonNormal" }), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // A branch the log is not in sees nothing, and cannot ask for another branch.
    const other = await createTestBranch();
    const { actor: elsewhere } = await createTestUser("ADMIN", { branchIds: [other.id] });
    expect((await workoutDashboard(elsewhere, { week: "15/10/2026" })).totals.sets).toBe(0);
    await expect(
      workoutDashboard(elsewhere, { week: "15/10/2026", branchId: (await prisma.branch.findFirstOrThrow()).id }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    for (const bad of [{ week: "99/99/2026" }, { branchId: "nope" }]) {
      await expect(workoutDashboard(w.master, bad)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    for (const bad of [
      { kind: "other" },
      { kind: "flag" },
      { kind: "flag", optionId: "nope" },
      { kind: "action", pageSize: "101" },
    ]) {
      await expect(workoutDrill(w.master, bad)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });
});

/** An approved plan of two planned sessions (Squat each) for the customer, written by the manager. */
async function approvedPlan(w: World, who: World["first"], trainerId: string) {
  const stage = await createStage(w.admin, { name: "Rehab" });
  const plan = await createPlan(who.manager, {
    kind: "CUSTOMER",
    customerId: who.customer.id,
    contractId: who.contract.id,
    trainerId,
  });
  await updatePlan(who.manager, plan.id, {
    name: "Giáo án An",
    phase: "Phase 1",
    goal: "Khỏe lưng",
    stages: [
      {
        stageId: stage.id,
        sessions: [1, 2].map((number) => ({
          week: 1,
          number,
          items: [
            {
              exerciseId: w.squat.id,
              sets: [
                { weight: "40", reps: "5" },
                { weight: "45", reps: "5" },
              ],
            },
          ],
        })),
      },
    ],
  });
  await submitPlan(who.manager, plan.id);
  const request = await prisma.approvalRequest.findFirstOrThrow({
    where: { actionType: "workout.plan", entityId: plan.id, status: "PENDING" },
  });
  await approveRequest(w.master, request.id);
  return plan;
}

describe("a customer's progress (brief §7.5, AC-20)", () => {
  it("counts the sessions done on the plan, names the phase and stage, and follows the exercises and scales", async () => {
    const w = await world();
    const pt = await linkedTrainer(w.first.manager, "PT Linh");
    const plan = await approvedPlan(w, w.first, pt.trainer.id);

    // Before any session: nothing done, the first stage is the one now.
    const none = await getProgress(w.master, w.first.customer.id);
    expect(none).toMatchObject({
      plan: { id: plan.id, phase: "Phase 1", goal: "Khỏe lưng", done: 0, planned: 2, currentStage: "Rehab" },
      sessions: [],
      exercises: [],
      history: [],
    });

    const log = async (date: string, extra: Record<string, unknown>, edits: Record<number, object>) => {
      const booking = await book(w.first.manager, w.first, { date }, pt.trainer.id);
      const opened = await createLog(pt.actor, { bookingId: booking.id });
      return updateLog(pt.actor, opened.id, {
        ...extra,
        items: opened.items.map((item) => ({
          id: item.id,
          exerciseId: item.exercise.id,
          sets: item.sets.map((set) => ({
            id: set.id,
            weight: set.weight,
            reps: set.reps,
            flagId: set.flag.id,
            actionId: set.action.id,
            ...edits[set.setNo],
          })),
        })),
      });
    };
    await log(
      "12/10/2026",
      { preStress: 7, preEnergy: 4, postSrpe: 8, postEnergy: 5 },
      {
        2: { weight: "47,5", flagId: w.flags.overload, actionId: w.actions.reduce, note: "Nặng quá" },
      },
    );
    await log(
      "14/10/2026",
      { preStress: 3, preEnergy: 8, postSrpe: 6, postEnergy: 7 },
      { 1: { weight: "42,5", reps: "6" } },
    );

    const progress = await getProgress(pt.actor, w.first.customer.id);
    expect(progress.plan).toMatchObject({ done: 2, planned: 2, currentStage: "Rehab" });
    expect(progress.sessions.map((s) => [s.stress, s.energy, s.srpe, s.energyAfter, s.flagged])).toEqual([
      [7, 4, 8, 5, 1],
      [3, 8, 6, 7, 0],
    ]);
    // The exercise: the heaviest weight and the reps of each session, oldest first.
    expect(progress.exercises).toHaveLength(1);
    expect(progress.exercises[0]!.exercise).toMatchObject({ name: "Squat", kind: "STRENGTH" });
    expect(progress.exercises[0]!.points.map((p) => [p.sets, p.topWeight, p.totalReps])).toEqual([
      [2, 47.5, 10],
      [2, 45, 11],
    ]);
    // Only the sets with a Flag or Action beyond the defaults, newest first.
    expect(progress.history).toHaveLength(1);
    expect(progress.history[0]).toMatchObject({
      exercise: "Squat",
      setNo: 2,
      note: "Nặng quá",
      flag: { code: "OVERLOAD" },
      action: { code: "REDUCE" },
    });
    const opened = await getLog(pt.actor, progress.sessions[0]!.logId);
    expect(opened.items[0]!.sets[1]!.weight).toBe(47.5);
  });

  it("stays within what the reader may see, and a customer with no sessions has an empty course", async () => {
    const w = await world();
    const pt = await linkedTrainer(w.first.manager, "PT Linh");
    await logOn(w, w.first, "13/10/2026", [[w.flags.normal, w.actions.none]]);
    // A customer with no plan and no sessions.
    const empty = await getProgress(w.master, w.second.customer.id);
    expect(empty).toMatchObject({ plan: null, sessions: [], exercises: [], history: [] });
    // A PT who does not teach the customer does not see it; reception has no access; bad ids are refused.
    await expect(getProgress(pt.actor, w.first.customer.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { actor: reception } = await createTestUser("RECEPTIONIST", { allBranches: true });
    await expect(getProgress(reception, w.first.customer.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getProgress(w.master, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getProgress(w.master, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = await createTestBranch();
    const { actor: elsewhere } = await createTestUser("ADMIN", { branchIds: [other.id] });
    await expect(getProgress(elsewhere, w.first.customer.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The run, a Cardio exercise, is not in the course until it is done.
    expect(w.run.kind).toBe("CARDIO");
  });
});
