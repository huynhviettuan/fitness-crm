import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { approveRequest } from "../../src/modules/approvals/approval.service.js";
import { cancelBooking } from "../../src/modules/bookings/booking.service.js";
import { createArea, createExercise, createStage, updateExercise } from "../../src/modules/workouts/catalog.service.js";
import { createLog, getLog, listLogs, updateLog } from "../../src/modules/workouts/log.service.js";
import { createPlan, getPlan, revisePlan, submitPlan, updatePlan } from "../../src/modules/workouts/plan.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { updateOption } from "../../src/platform/options/option.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId, type RoleCode } from "../support/factories.js";
import { book, bookingScenario, linkedTrainer } from "../support/bookings.js";

afterEach(resetDatabase);

// The session log (M7.3; brief §7.3; FR-WKO-003; D-033; A-199 to A-205).

async function world() {
  const scenario = await bookingScenario();
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const { actor: master } = await createTestUser("MASTER", { allBranches: true });
  const pt = await linkedTrainer(scenario.manager, "PT Linh");
  const stage = await createStage(admin, { name: "Rehab" });
  const area = await createArea(admin, { code: "LOW", name: "Thân dưới" });
  const squat = await createExercise(admin, { name: "Squat", areaId: area.id, kind: "STRENGTH" });
  const run = await createExercise(admin, { name: "Chạy bộ", areaId: area.id, kind: "CARDIO" });
  const press = await createExercise(admin, { name: "Đẩy tạ", areaId: area.id, kind: "STRENGTH" });
  const flags = {
    normal: await optionId("workoutFlags", "Normal"),
    stress: await optionId("workoutFlags", "Stress"),
    other: await optionId("workoutFlags", "Khác"),
  };
  const actions = {
    none: await optionId("workoutActions", "None"),
    reduce: await optionId("workoutActions", "Giảm tải"),
    stop: await optionId("workoutActions", "Dừng + Escalation"),
  };
  return { ...scenario, admin, master, pt, stage, area, squat, run, press, flags, actions };
}
type World = Awaited<ReturnType<typeof world>>;

/** An approved plan of the customer: session 1 has Squat (two sets) and a run, session 2 has Squat (one set). */
async function approvedPlan(w: World) {
  const plan = await createPlan(w.manager, {
    kind: "CUSTOMER",
    customerId: w.customer.id,
    contractId: w.contract.id,
    trainerId: w.pt.trainer.id,
  });
  await updatePlan(w.manager, plan.id, {
    name: "Giáo án An",
    stages: [
      {
        stageId: w.stage.id,
        sessions: [
          {
            week: 1,
            number: 1,
            goal: "Làm quen",
            items: [
              {
                exerciseId: w.squat.id,
                sets: [
                  { weight: "40", reps: "10", rir: "3", restSeconds: "90" },
                  { weight: "45", reps: "8" },
                ],
              },
              { exerciseId: w.run.id, sets: [{ durationMinutes: "15", speed: "8,5", heartRate: "130" }] },
            ],
          },
          {
            week: 1,
            number: 2,
            goal: "Tăng tải",
            items: [{ exerciseId: w.squat.id, sets: [{ weight: "50", reps: "6" }] }],
          },
        ],
      },
    ],
  });
  await submitPlan(w.manager, plan.id);
  const request = await prisma.approvalRequest.findFirstOrThrow({
    where: { actionType: "workout.plan", entityId: plan.id, status: "PENDING" },
  });
  await approveRequest(w.master, request.id);
  return getPlan(w.manager, plan.id);
}

/** A set as the form sends it: the row as the log shows it, with the Flag and Action ids. */
const setOf = (set: Awaited<ReturnType<typeof getLog>>["items"][number]["sets"][number], extra = {}) => ({
  id: set.id,
  weight: set.weight,
  reps: set.reps,
  rir: set.rir,
  durationMinutes: set.durationMinutes,
  speed: set.speed,
  heartRate: set.heartRate,
  flagId: set.flag.id,
  flagNote: set.flag.note,
  actionId: set.action.id,
  actionNote: set.action.note,
  note: set.note,
  ...extra,
});

/** The log as a save sends it back, with changes by exercise name and set number. */
function contentOf(log: Awaited<ReturnType<typeof getLog>>, changes: Record<string, Record<number, object>> = {}) {
  return {
    goal: log.goal,
    preStress: log.pre.stress.value,
    preStressNote: log.pre.stress.note,
    preEnergy: log.pre.energy.value,
    preEnergyNote: log.pre.energy.note,
    preImpactId: log.pre.impact?.id ?? "",
    preImpactNote: log.pre.impact?.note ?? "",
    postSrpe: log.post.srpe.value,
    postSrpeNote: log.post.srpe.note,
    postEnergy: log.post.energy.value,
    postEnergyNote: log.post.energy.note,
    postSummaryId: log.post.summary?.id ?? "",
    postSummaryNote: log.post.summary?.note ?? "",
    coachNotes: log.coachNotes,
    items: log.items.map((item) => ({
      id: item.id,
      exerciseId: item.exercise.id,
      sets: item.sets.map((set) => setOf(set, changes[item.exercise.name]?.[set.setNo])),
    })),
  };
}

describe("opening a log (brief §7.3)", () => {
  it("starts from the next planned session, with the plan and the actual on one row, Flag Normal and Action None", async () => {
    const w = await world();
    const plan = await approvedPlan(w);
    const booking = await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id);

    const log = await createLog(w.pt.actor, { bookingId: booking.id });
    expect(log).toMatchObject({
      bookingId: booking.id,
      goal: "Làm quen",
      plan: { id: plan.id },
      customer: { id: w.customer.id },
      trainer: { id: w.pt.trainer.id },
      contract: { id: w.contract.id },
      canEdit: true,
      exercises: 2,
      sets: 3,
    });
    expect(log.planSession).toMatchObject({ week: 1, number: 1 });
    const [squat, run] = log.items;
    expect(squat).toMatchObject({ planned: true, exercise: { name: "Squat", kind: "STRENGTH" } });
    expect(squat!.sets[0]).toMatchObject({
      planned: { weight: 40, reps: 10, rir: 3, restSeconds: 90 },
      weight: 40,
      reps: 10,
      rir: 3,
      flag: { id: w.flags.normal, note: null },
      action: { id: w.actions.none },
    });
    expect(squat!.sets[1]).toMatchObject({ weight: 45, reps: 8, rir: null });
    // A Cardio row has time, speed and heart rate, and no weights.
    expect(run!.sets[0]).toMatchObject({
      planned: { durationMinutes: 15, speed: 8.5, heartRate: 130 },
      durationMinutes: 15,
      speed: 8.5,
      heartRate: 130,
      weight: null,
      reps: null,
    });
    expect(log.pre.stress).toEqual({ value: null, note: null });
    expect(log.post.summary).toBeNull();
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: log.id, action: "workout_log.created" } });
    expect(audit).not.toBeNull();
  });

  it("returns the log already open, also when two requests open it at once", async () => {
    const w = await world();
    await approvedPlan(w);
    const booking = await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id);
    const results = await Promise.allSettled([
      createLog(w.pt.actor, { bookingId: booking.id }),
      createLog(w.pt.actor, { bookingId: booking.id }),
      createLog(w.manager, { bookingId: booking.id }),
    ]);
    const logs = results.map((result) => (result.status === "fulfilled" ? result.value.id : null));
    expect(logs.every((id) => id !== null && id === logs[0])).toBe(true);
    expect(await prisma.workoutLog.count({ where: { bookingId: booking.id } })).toBe(1);
  });

  it("follows the next planned session no log has used, or the one the coach names", async () => {
    const w = await world();
    const plan = await approvedPlan(w);
    const first = await createLog(w.pt.actor, {
      bookingId: (await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id)).id,
    });
    const second = await createLog(w.pt.actor, {
      bookingId: (await book(w.manager, w, { date: "16/10/2026" }, w.pt.trainer.id)).id,
    });
    expect([first.planSession?.number, second.planSession?.number]).toEqual([1, 2]);
    // Every planned session is used: the next log starts empty.
    const third = await createLog(w.pt.actor, {
      bookingId: (await book(w.manager, w, { date: "17/10/2026" }, w.pt.trainer.id)).id,
    });
    expect(third).toMatchObject({ planSession: null, exercises: 0, goal: null });
    expect(third.plan).toBeNull();
    // Naming a session of the plan repeats it; a session of nothing is refused.
    const fourth = await createLog(w.pt.actor, {
      bookingId: (await book(w.manager, w, { date: "18/10/2026" }, w.pt.trainer.id)).id,
      planSessionId: first.planSession!.id,
    });
    expect(fourth.planSession).toMatchObject({ number: 1 });
    expect(fourth.plan?.id).toBe(plan.id);
    await expect(
      createLog(w.pt.actor, {
        bookingId: (await book(w.manager, w, { date: "19/10/2026" }, w.pt.trainer.id)).id,
        planSessionId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("starts empty when the customer has no approved plan, and the coach writes the rows", async () => {
    const w = await world();
    const booking = await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id);
    const log = await createLog(w.pt.actor, { bookingId: booking.id });
    expect(log).toMatchObject({ plan: null, planSession: null, exercises: 0, sets: 0 });

    const saved = await updateLog(w.pt.actor, log.id, {
      ...contentOf(log),
      items: [
        {
          exerciseId: w.press.id,
          sets: [{ weight: "30", reps: "12", flagId: w.flags.normal, actionId: w.actions.none }],
        },
      ],
    });
    expect(saved.items[0]).toMatchObject({ planned: false, exercise: { name: "Đẩy tạ" } });
    expect(saved.items[0]!.sets[0]).toMatchObject({ planned: null, weight: 30, reps: 12 });
    // The coach's own rows can be taken out again.
    const emptied = await updateLog(w.pt.actor, log.id, { ...contentOf(saved), items: [] });
    expect(emptied.exercises).toBe(0);
  });

  it("refuses a cancelled session, an unknown one and someone else's, and a PT opens only their own", async () => {
    const w = await world();
    const booking = await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id);
    const cancelled = await book(w.manager, w, { date: "16/10/2026" }, w.pt.trainer.id);
    await cancelBooking(w.manager, cancelled.id);
    await expect(createLog(w.pt.actor, { bookingId: cancelled.id })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(createLog(w.pt.actor, { bookingId: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createLog(w.pt.actor, { bookingId: "nope" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    // Another PT does not see the session at all, so there is nothing to open; the manager may open any of the branch.
    const stranger = await linkedTrainer(w.manager, "PT Hoa");
    await expect(createLog(stranger.actor, { bookingId: booking.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await createLog(w.manager, { bookingId: booking.id })).canEdit).toBe(true);
  });
});

describe("filling in the log (brief §7.3)", () => {
  it("keeps the three parts and the rows, and the plan's targets stay as they were", async () => {
    const w = await world();
    await approvedPlan(w);
    const booking = await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id);
    const log = await createLog(w.pt.actor, { bookingId: booking.id });
    const impact = await optionId("sessionImpacts", "Cao");
    const summary = await optionId("sessionSummaries", "Tốt hơn");

    const saved = await updateLog(w.pt.actor, log.id, {
      ...contentOf(log, { Squat: { 1: { weight: "42,5", reps: "9", flagId: w.flags.stress, note: "Đau gối nhẹ" } } }),
      preStress: "7",
      preStressNote: "Họp nhiều",
      preEnergy: 4,
      preImpactId: impact,
      postSrpe: "8",
      postEnergy: "5",
      postSummaryId: summary,
      coachNotes: "Giữ mức tạ tuần sau",
    });
    expect(saved.pre).toMatchObject({
      stress: { value: 7, note: "Họp nhiều" },
      energy: { value: 4 },
      impact: { id: impact },
    });
    expect(saved.post).toMatchObject({ srpe: { value: 8 }, energy: { value: 5 }, summary: { id: summary } });
    expect(saved.coachNotes).toBe("Giữ mức tạ tuần sau");
    expect(saved.updatedBy?.id).toBe(w.pt.actor.id);
    expect(saved.items[0]!.sets[0]).toMatchObject({
      weight: 42.5,
      reps: 9,
      flag: { id: w.flags.stress },
      note: "Đau gối nhẹ",
      // The plan did not move.
      planned: { weight: 40, reps: 10 },
    });

    // A revision of the plan later does not change what was logged.
    const revision = await revisePlan(w.manager, log.plan!.id);
    await updatePlan(w.manager, revision.id, {
      name: "Giáo án An",
      stages: [
        {
          stageId: w.stage.id,
          sessions: [{ week: 1, number: 1, items: [{ exerciseId: w.squat.id, sets: [{ weight: "99", reps: "1" }] }] }],
        },
      ],
    });
    const again = await getLog(w.pt.actor, log.id);
    expect(again.items[0]!.sets[0]!.planned).toMatchObject({ weight: 40, reps: 10 });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: log.id, action: "workout_log.updated" },
    });
    expect(audit.before).toMatchObject({ preStress: null, exercises: 2, sets: 3 });
    expect(audit.after).toMatchObject({ preStress: 7, postSrpe: 8, exercises: 2, sets: 3 });
  });

  it("lets the coach add sets and exercises, and take out only what they added", async () => {
    const w = await world();
    await approvedPlan(w);
    const log = await createLog(w.pt.actor, {
      bookingId: (await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id)).id,
    });
    const base = contentOf(log);
    const withExtras = await updateLog(w.pt.actor, log.id, {
      ...base,
      items: [
        {
          ...base.items[0]!,
          sets: [...base.items[0]!.sets, { weight: "50", reps: "5", flagId: w.flags.normal, actionId: w.actions.none }],
        },
        base.items[1]!,
        {
          exerciseId: w.press.id,
          sets: [{ weight: "20", reps: "15", flagId: w.flags.normal, actionId: w.actions.none }],
        },
      ],
    });
    expect(withExtras.items.map((item) => [item.exercise.name, item.planned, item.sets.length])).toEqual([
      ["Squat", true, 3],
      ["Chạy bộ", true, 1],
      ["Đẩy tạ", false, 1],
    ]);
    expect(withExtras.items[0]!.sets[2]).toMatchObject({ setNo: 3, planned: null, weight: 50 });

    // The sets the plan made cannot be removed, nor the exercises.
    const kept = contentOf(withExtras);
    await expect(
      updateLog(w.pt.actor, log.id, {
        ...kept,
        items: [{ ...kept.items[0]!, sets: kept.items[0]!.sets.slice(1) }, kept.items[1]!, kept.items[2]!],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { "items.0.sets": ["plannedSetRemoved"] },
    });
    await expect(updateLog(w.pt.actor, log.id, { ...kept, items: kept.items.slice(1) })).rejects.toMatchObject({
      fieldErrors: { items: ["plannedExerciseRemoved"] },
    });
    // What the coach added goes when it is left out.
    const trimmed = await updateLog(w.pt.actor, log.id, {
      ...kept,
      items: [{ ...kept.items[0]!, sets: kept.items[0]!.sets.slice(0, 2) }, kept.items[1]!],
    });
    expect(trimmed.items.map((item) => item.sets.length)).toEqual([2, 1]);
  });

  it("checks the exercise kind, the choices and the numbers", async () => {
    const w = await world();
    await approvedPlan(w);
    const log = await createLog(w.pt.actor, {
      bookingId: (await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id)).id,
    });
    const fields = async (input: unknown) => {
      try {
        await updateLog(w.pt.actor, log.id, input);
      } catch (error) {
        return (error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
      }
      return undefined;
    };

    // A weight on a Cardio row and a speed on a Strength row.
    expect(await fields(contentOf(log, { "Chạy bộ": { 1: { weight: "5" } } }))).toEqual({
      "items.1.sets.0.weight": ["notForThisExercise"],
    });
    expect(await fields(contentOf(log, { Squat: { 1: { speed: "5" } } }))).toEqual({
      "items.0.sets.0.speed": ["notForThisExercise"],
    });
    // "Khác" needs a note; an option of another list, or an unknown one, is refused.
    expect(await fields(contentOf(log, { Squat: { 1: { flagId: w.flags.other } } }))).toEqual({
      "items.0.sets.0.flagNote": ["otherNeedsNote"],
    });
    expect(await fields(contentOf(log, { Squat: { 1: { flagId: w.actions.none } } }))).toEqual({
      "items.0.sets.0.flagId": ["invalidChoice"],
    });
    expect(await fields(contentOf(log, { Squat: { 1: { actionId: randomUUID() } } }))).toEqual({
      "items.0.sets.0.actionId": ["invalidChoice"],
    });
    expect(await fields({ ...contentOf(log), preImpactId: w.flags.normal })).toEqual({
      preImpactId: ["invalidChoice"],
    });
    // Rows that are not in this log.
    const base = contentOf(log);
    expect(await fields({ ...base, items: [{ ...base.items[0]!, id: randomUUID() }, base.items[1]!] })).toEqual({
      "items.0.id": ["invalidChoice"],
    });
    expect(await fields({ ...base, items: [{ ...base.items[0]!, exerciseId: w.press.id }, base.items[1]!] })).toEqual({
      "items.0.exerciseId": ["invalidChoice"],
    });
    // The scales are 1 to 10; the numbers are not negative.
    for (const bad of [{ preStress: 0 }, { preEnergy: 11 }, { postSrpe: 5.5 }, { postEnergy: "x" }]) {
      await expect(updateLog(w.pt.actor, log.id, { ...base, ...bad })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    }
    await expect(
      updateLog(w.pt.actor, log.id, contentOf(log, { Squat: { 1: { weight: "-1" } } })),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    // Nothing was saved by the refused ones.
    expect((await getLog(w.pt.actor, log.id)).pre.stress.value).toBeNull();
  });

  it("keeps a retired Flag on the set that has it, and refuses it on others", async () => {
    const w = await world();
    await approvedPlan(w);
    const log = await createLog(w.pt.actor, {
      bookingId: (await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id)).id,
    });
    await updateLog(w.pt.actor, log.id, contentOf(log, { Squat: { 1: { flagId: w.flags.stress } } }));
    const stress = await prisma.option.findUniqueOrThrow({ where: { id: w.flags.stress } });
    await updateOption(w.admin, "workoutFlags", stress.id, {
      labelVi: stress.labelVi,
      labelEn: stress.labelEn,
      code: stress.code ?? "",
      active: false,
    });
    const current = await getLog(w.pt.actor, log.id);
    await updateLog(w.pt.actor, log.id, contentOf(current));
    await expect(
      updateLog(w.pt.actor, log.id, contentOf(current, { Squat: { 2: { flagId: w.flags.stress } } })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("keeps an exercise made inactive on the log that has it", async () => {
    const w = await world();
    await approvedPlan(w);
    const log = await createLog(w.pt.actor, {
      bookingId: (await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id)).id,
    });
    await updateExercise(w.admin, w.squat.id, {
      name: "Squat",
      areaId: w.area.id,
      kind: "STRENGTH",
      active: false,
    });
    await updateLog(w.pt.actor, log.id, contentOf(await getLog(w.pt.actor, log.id)));
    const base = contentOf(log);
    await expect(
      updateLog(w.pt.actor, log.id, {
        ...base,
        items: [
          ...base.items,
          { exerciseId: w.squat.id, sets: [{ flagId: w.flags.normal, actionId: w.actions.none }] },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("two saves of one log take turns", async () => {
    const w = await world();
    await approvedPlan(w);
    const log = await createLog(w.pt.actor, {
      bookingId: (await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id)).id,
    });
    const content = contentOf(log);
    await Promise.all([
      updateLog(w.pt.actor, log.id, { ...content, coachNotes: "A" }),
      updateLog(w.manager, log.id, { ...content, coachNotes: "B" }),
    ]);
    const final = await getLog(w.manager, log.id);
    expect(["A", "B"]).toContain(final.coachNotes);
    expect(final.items.map((item) => item.sets.length)).toEqual([2, 1]);
  });
});

describe("who sees and writes logs", () => {
  it("shows a PT their own sessions' logs, the manager and the Master the branch's, and nobody else's branch", async () => {
    const w = await world();
    const mine = await createLog(w.pt.actor, {
      bookingId: (await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id)).id,
    });
    const theirs = await createLog(w.manager, {
      bookingId: (await book(w.manager, w, { date: "16/10/2026" }, w.trainer.id)).id,
    });
    const ids = async (actor: World["admin"], query: Record<string, string> = {}) =>
      (await listLogs(actor, query)).items.map((item) => item.id).sort();

    // The PT created neither customer nor the other session, so they see only their own.
    expect(await ids(w.pt.actor)).toEqual([mine.id]);
    expect(await ids(w.manager)).toEqual([mine.id, theirs.id].sort());
    expect(await ids(w.master)).toEqual([mine.id, theirs.id].sort());
    expect(await ids(w.manager, { trainerId: w.trainer.id })).toEqual([theirs.id]);
    expect(await ids(w.manager, { customerId: w.customer.id })).toEqual([mine.id, theirs.id].sort());
    expect(await ids(w.manager, { customerId: randomUUID() })).toEqual([]);
    await expect(getLog(w.pt.actor, theirs.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateLog(w.pt.actor, theirs.id, contentOf(theirs))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getLog(w.master, mine.id)).canEdit).toBe(false);
    await expect(updateLog(w.master, mine.id, contentOf(mine))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listLogs(w.manager, {})).items[0]).toMatchObject({ customer: { id: w.customer.id }, sets: 0 });

    const { createTestBranch } = await import("../support/factories.js");
    const other = await createTestBranch();
    const { actor: elsewhere } = await createTestUser("ADMIN", { branchIds: [other.id] });
    expect(await ids(elsewhere)).toEqual([]);
    await expect(getLog(elsewhere, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is written by Admin, the manager and the PT, read by the Master, and closed to reception, consulting and accounting", async () => {
    const w = await world();
    const booking = await book(w.manager, w, { date: "15/10/2026" }, w.pt.trainer.id);
    for (const role of ["MASTER", "RECEPTIONIST", "CONSULTING", "ACCOUNTANT", "MARKETING"] as RoleCode[]) {
      const { actor } = await createTestUser(role, { allBranches: true });
      await expect(createLog(actor, { bookingId: booking.id }), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const log = await createLog(w.admin, { bookingId: booking.id });
    for (const role of ["RECEPTIONIST", "CONSULTING", "ACCOUNTANT", "MARKETING"] as RoleCode[]) {
      const { actor } = await createTestUser(role, { allBranches: true });
      await expect(getLog(actor, log.id), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(listLogs(actor, {}), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(updateLog(actor, log.id, contentOf(log)), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("refuses bad ids and bad inputs with a field error, never a server error", async () => {
    const w = await world();
    await expect(getLog(w.admin, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateLog(w.admin, "not-a-uuid", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateLog(w.admin, randomUUID(), { items: [] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createLog(w.admin, {})).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    for (const query of [{ pageSize: "101" }, { page: "0" }, { customerId: "nope" }]) {
      await expect(listLogs(w.admin, query)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });
});
