import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { approveRequest, rejectRequest } from "../../src/modules/approvals/approval.service.js";
import {
  createArea,
  createEquipment,
  createExercise,
  createStage,
  updateExercise,
} from "../../src/modules/workouts/catalog.service.js";
import {
  createPlan,
  getPlan,
  listPlans,
  reviewPlan,
  revisePlan,
  submitPlan,
  updatePlan,
} from "../../src/modules/workouts/plan.service.js";
import { resetDatabase } from "../support/database.js";
import {
  DEFAULT_BRANCH_ID,
  createTestBranch,
  createTestUser,
  optionId,
  withoutApprovals,
  type RoleCode,
} from "../support/factories.js";
import { activeContract, book, bookingScenario, createTrainer, linkedTrainer } from "../support/bookings.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { createContract } from "../../src/modules/contracts/contract.service.js";
import { contractInput } from "../support/bookings.js";
import { randomUUID } from "node:crypto";

afterEach(resetDatabase);

// Workout plan templates and customer plans (M7.2; brief §7.1, §7.2; FR-WKO-001, FR-WKO-002; D-033, D-018; A-192 to A-198).

const REJECT = await optionId("rejectReasons", "Khác");

async function world() {
  const scenario = await bookingScenario();
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const { actor: master } = await createTestUser("MASTER", { allBranches: true });
  const pt = await linkedTrainer(scenario.manager, "PT Linh");
  // The customer trains with this PT, so they are one of the PT's own customers (data scope "own").
  await book(scenario.manager, scenario, { date: "15/10/2026" }, pt.trainer.id);
  const rehab = await createStage(admin, { name: "Rehab" });
  const strength = await createStage(admin, { name: "Strength" });
  const area = await createArea(admin, { code: "LOW", name: "Thân dưới" });
  const bar = await createEquipment(admin, { code: "BB", name: "Barbell" });
  const squat = await createExercise(admin, { name: "Squat", areaId: area.id, equipmentId: bar.id, kind: "STRENGTH" });
  const run = await createExercise(admin, { name: "Chạy bộ", areaId: area.id, kind: "CARDIO" });
  return { ...scenario, admin, master, pt, rehab, strength, area, bar, squat, run };
}
type World = Awaited<ReturnType<typeof world>>;

/** A template's content: a stage with one session of a Strength exercise (two sets) and a Cardio one. */
const templateContent = (w: World, overrides: Record<string, unknown> = {}) => ({
  name: "Template phục hồi",
  stages: [
    {
      stageId: w.rehab.id,
      sessions: [
        {
          goal: "Làm quen",
          items: [
            {
              exerciseId: w.squat.id,
              sets: [
                { weight: "40", reps: "10", restSeconds: "90", rir: "3", tempo: "3-1-1" },
                { weight: "45", reps: "8" },
              ],
            },
            { exerciseId: w.run.id, sets: [{ durationMinutes: "15", speed: "8,5", heartRate: "130" }] },
          ],
        },
      ],
    },
    {
      stageId: w.strength.id,
      sessions: [{ goal: "Sức mạnh", items: [{ exerciseId: w.squat.id, sets: [{ weight: "60", reps: "5" }] }] }],
    },
  ],
  ...overrides,
});

const pendingOf = (planId: string) =>
  prisma.approvalRequest.findFirstOrThrow({
    where: { actionType: "workout.plan", entityId: planId, status: "PENDING" },
  });

/** A template written, sent and approved by the Master. */
async function approvedTemplate(w: World) {
  const template = await createPlan(w.admin, { kind: "TEMPLATE", name: "Template", branchId: "" });
  await updatePlan(w.admin, template.id, templateContent(w));
  await submitPlan(w.admin, template.id);
  await approveRequest(w.master, (await pendingOf(template.id)).id);
  return getPlan(w.admin, template.id);
}

const customerPlan = (w: World, extra: Record<string, unknown> = {}) => ({
  kind: "CUSTOMER",
  customerId: w.customer.id,
  contractId: w.contract.id,
  ...extra,
});

describe("templates (brief §7.1)", () => {
  it("are written as a draft, sent to the Master, and in use once approved", async () => {
    const w = await world();
    const template = await createPlan(w.admin, { kind: "TEMPLATE", name: "Template", branchId: "" });
    expect(template).toMatchObject({
      kind: "TEMPLATE",
      status: "DRAFT",
      customer: null,
      can: { edit: true, submit: true },
    });

    const saved = await updatePlan(w.admin, template.id, templateContent(w));
    expect(saved.stages.map((stage) => stage.stage.name)).toEqual(["Rehab", "Strength"]);
    const session = saved.stages[0]!.sessions[0]!;
    expect(session).toMatchObject({ week: null, number: null, goal: "Làm quen" });
    expect(session.items[0]!.sets[0]).toMatchObject({
      setNo: 1,
      weight: 40,
      reps: 10,
      restSeconds: 90,
      rir: 3,
      tempo: "3-1-1",
      durationMinutes: null,
    });
    expect(session.items[1]).toMatchObject({ exercise: { name: "Chạy bộ", kind: "CARDIO" } });
    expect(session.items[1]!.sets[0]).toMatchObject({ durationMinutes: 15, speed: 8.5, heartRate: 130, weight: null });

    const sent = await submitPlan(w.admin, template.id);
    expect(sent).toMatchObject({ status: "PENDING", can: { edit: false, submit: false } });
    const request = await pendingOf(template.id);
    expect(request).toMatchObject({ entityType: "workout_plan", submittedById: w.admin.id });
    // Nobody approves their own submission (D-018); the Master does.
    await expect(approveRequest(w.admin, request.id)).rejects.toMatchObject({ code: "APPROVAL_OWN_REQUEST" });
    await approveRequest(w.master, request.id);

    expect(await getPlan(w.admin, template.id)).toMatchObject({
      status: "APPROVED",
      approvedBy: { id: w.master.id },
      can: { edit: false, revise: true },
    });
  });

  it("are not edited once sent or approved: the service refuses, and so does the database", async () => {
    const w = await world();
    const template = await approvedTemplate(w);

    await expect(updatePlan(w.admin, template.id, templateContent(w, { name: "Đổi tên" }))).rejects.toMatchObject({
      code: "PLAN_NOT_EDITABLE",
    });
    await expect(submitPlan(w.admin, template.id)).rejects.toMatchObject({ code: "PLAN_NOT_EDITABLE" });
    // Even straight into the table, for every role.
    await expect(prisma.workoutPlanSet.updateMany({ data: { reps: 99 } })).rejects.toThrow();
    await expect(prisma.workoutPlanStage.deleteMany({ where: { planId: template.id } })).rejects.toThrow();
    expect((await getPlan(w.admin, template.id)).stages[0]!.sessions[0]!.items[0]!.sets[0]!.reps).toBe(10);
  });

  it("have one session per stage and no weeks", async () => {
    const w = await world();
    const template = await createPlan(w.admin, { kind: "TEMPLATE", name: "Template", branchId: "" });
    const two = { goal: "", items: [] };

    await expect(
      updatePlan(w.admin, template.id, { name: "T", stages: [{ stageId: w.rehab.id, sessions: [two, two] }] }),
    ).rejects.toMatchObject({ fieldErrors: { "stages.0.sessions": ["templateOneSession"] } });
    await expect(
      updatePlan(w.admin, template.id, {
        name: "T",
        stages: [{ stageId: w.rehab.id, sessions: [{ ...two, week: 1, number: 1 }] }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { "stages.0.sessions.0.week": ["templateHasNoWeeks"] } });
  });

  it("can be retired once approved by a revision, and only approved ones make plans", async () => {
    const w = await world();
    const draft = await createPlan(w.admin, { kind: "TEMPLATE", name: "Chưa duyệt", branchId: "" });

    await expect(
      createPlan(w.manager, customerPlan(w, { trainerId: w.pt.trainer.id, templateId: draft.id })),
    ).rejects.toMatchObject({
      fieldErrors: { templateId: ["invalidChoice"] },
    });
  });
});

describe("a customer's plan (brief §7.2)", () => {
  it("is made from a template: each stage becomes weeks of sessions, numbered through the plan, with the sets copied", async () => {
    const w = await world();
    const template = await approvedTemplate(w);

    const plan = await createPlan(
      w.pt.actor,
      customerPlan(w, { templateId: template.id, weeksPerStage: "2", sessionsPerWeek: "3" }),
    );

    expect(plan).toMatchObject({
      kind: "CUSTOMER",
      status: "DRAFT",
      name: "Giáo án Nguyễn Văn An",
      sourceTemplate: { id: template.id },
      trainer: { id: w.pt.trainer.id },
      contract: { id: w.contract.id },
      sessions: 12,
    });
    expect(plan.stages[0]!.sessions.map((session) => [session.week, session.number])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    expect(plan.stages[1]!.sessions[0]).toMatchObject({ week: 3, number: 1, goal: "Sức mạnh" });
    expect(plan.stages[1]!.sessions.at(-1)).toMatchObject({ week: 4, number: 3 });
    expect(plan.stages[0]!.sessions[5]!.items[0]!.sets[1]).toMatchObject({ weight: 45, reps: 8 });
    expect(plan.can).toMatchObject({ edit: true, reviewAsPt: true, reviewAsMaster: false });
  });

  it("can start blank, and is then written by the coach with weeks and sessions of its own", async () => {
    const w = await world();
    const plan = await createPlan(w.pt.actor, customerPlan(w, { name: "Giáo án 8 tuần" }));
    expect(plan).toMatchObject({ name: "Giáo án 8 tuần", sessions: 0 });

    const saved = await updatePlan(w.pt.actor, plan.id, {
      name: "Giáo án 8 tuần",
      phase: "Phase 1",
      goal: "Giảm mỡ",
      notes: "Đau gối nhẹ",
      stages: [
        {
          stageId: w.rehab.id,
          sessions: [
            {
              week: 1,
              number: 1,
              goal: "A",
              items: [{ exerciseId: w.squat.id, sets: [{ weight: "30", reps: "12" }] }],
            },
            { week: 1, number: 2, goal: "B", items: [{ exerciseId: w.run.id, sets: [{ durationMinutes: "20" }] }] },
          ],
        },
      ],
    });

    expect(saved).toMatchObject({ phase: "Phase 1", goal: "Giảm mỡ", notes: "Đau gối nhẹ", sessions: 2 });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: plan.id, action: "workout_plan.updated" },
    });
    expect(event).toMatchObject({
      actorUserId: w.pt.actor.id,
      after: { stages: 1, sessions: 2, exercises: 2, sets: 2 },
    });
  });

  it("puts the Strength fields on Strength exercises and the Cardio fields on Cardio ones", async () => {
    const w = await world();
    const plan = await createPlan(w.pt.actor, customerPlan(w));
    const save = (item: Record<string, unknown>) =>
      updatePlan(w.pt.actor, plan.id, {
        name: "x",
        stages: [{ stageId: w.rehab.id, sessions: [{ week: 1, number: 1, items: [item] }] }],
      });

    await expect(save({ exerciseId: w.squat.id, sets: [{ weight: "30", speed: "9" }] })).rejects.toMatchObject({
      fieldErrors: { "stages.0.sessions.0.items.0.sets.0.speed": ["notForThisExercise"] },
    });
    await expect(save({ exerciseId: w.run.id, sets: [{ durationMinutes: "20", weight: "30" }] })).rejects.toMatchObject(
      {
        fieldErrors: { "stages.0.sessions.0.items.0.sets.0.weight": ["notForThisExercise"] },
      },
    );
    await expect(
      save({ exerciseId: w.run.id, sets: [{ videoUrl: "https://v.example.test/x" }] }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(save({ exerciseId: w.squat.id, sets: [{ reps: "0" }] })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(save({ exerciseId: randomUUID(), sets: [] })).rejects.toMatchObject({
      fieldErrors: { "stages.0.sessions.0.items.0.exerciseId": ["invalidChoice"] },
    });
  });

  it("numbers its sessions once, and each stage appears once", async () => {
    const w = await world();
    const plan = await createPlan(w.pt.actor, customerPlan(w));
    const session = (week: number, number: number) => ({ week, number, items: [] });

    await expect(
      updatePlan(w.pt.actor, plan.id, {
        name: "x",
        stages: [{ stageId: w.rehab.id, sessions: [session(1, 1), session(1, 1)] }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { "stages.0.sessions.1.number": ["duplicate"] } });
    await expect(
      updatePlan(w.pt.actor, plan.id, {
        name: "x",
        stages: [{ stageId: w.rehab.id, sessions: [{ items: [] }] }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { "stages.0.sessions.0.week": ["required"] } });
    await expect(
      updatePlan(w.pt.actor, plan.id, {
        name: "x",
        stages: [
          { stageId: w.rehab.id, sessions: [] },
          { stageId: w.rehab.id, sessions: [] },
        ],
      }),
    ).rejects.toMatchObject({ fieldErrors: { "stages.1.stageId": ["duplicate"] } });
  });

  it("keeps an exercise made inactive on the plans that have it, and refuses it on new ones", async () => {
    const w = await world();
    const plan = await createPlan(w.pt.actor, customerPlan(w));
    const content = {
      name: "x",
      stages: [
        {
          stageId: w.rehab.id,
          sessions: [{ week: 1, number: 1, items: [{ exerciseId: w.squat.id, sets: [{ reps: "5" }] }] }],
        },
      ],
    };
    await updatePlan(w.pt.actor, plan.id, content);
    await updateExercise(w.admin, w.squat.id, {
      name: "Squat",
      areaId: w.area.id,
      equipmentId: w.bar.id,
      kind: "STRENGTH",
      active: false,
    });

    await expect(updatePlan(w.pt.actor, plan.id, content)).resolves.toBeDefined();
    const other = await createPlan(w.pt.actor, customerPlan(w));
    await expect(updatePlan(w.pt.actor, other.id, content)).rejects.toMatchObject({
      fieldErrors: { "stages.0.sessions.0.items.0.exerciseId": ["invalidChoice"] },
    });
  });

  it("needs the customer's own approved contract, and a coach who teaches PT in its branch", async () => {
    const w = await world();
    const other = await createCustomer(w.manager, { fullName: "Khách khác", phone: "0911000111" });
    const otherContract = await activeContract(w.manager, other.id);
    const { contract: draft } = await createContract(w.manager, other.id, await contractInput(), randomUUID());
    const reception = await createTrainer(w.manager, { fullName: "Không phải PT" });
    await prisma.employee.update({ where: { id: reception.id }, data: { isTrainer: false } });

    await expect(
      createPlan(w.manager, customerPlan(w, { contractId: otherContract.id, trainerId: w.pt.trainer.id })),
    ).rejects.toMatchObject({
      fieldErrors: { contractId: ["invalidChoice"] },
    });
    await expect(
      createPlan(w.manager, {
        kind: "CUSTOMER",
        customerId: other.id,
        contractId: draft.id,
        trainerId: w.pt.trainer.id,
      }),
    ).rejects.toMatchObject({
      fieldErrors: { contractId: ["invalidChoice"] },
    });
    // A manager must name the coach; a name that is no PT is refused.
    await expect(createPlan(w.manager, customerPlan(w))).rejects.toMatchObject({
      fieldErrors: { trainerId: ["required"] },
    });
    await expect(createPlan(w.manager, customerPlan(w, { trainerId: reception.id }))).rejects.toMatchObject({
      fieldErrors: { trainerId: ["invalidChoice"] },
    });
    await expect(createPlan(w.manager, customerPlan(w, { trainerId: w.pt.trainer.id }))).resolves.toMatchObject({
      trainer: { id: w.pt.trainer.id },
    });
    // A PT's plan is their own, whoever the request names.
    const own = await createPlan(w.pt.actor, customerPlan(w, { trainerId: w.trainer.id }));
    expect(own.trainer?.id).toBe(w.pt.trainer.id);
  });
});

describe("approval and revisions (D-018, D-022)", () => {
  async function approvedPlan(w: World) {
    const plan = await createPlan(w.pt.actor, customerPlan(w, { name: "Giáo án A" }));
    await updatePlan(w.pt.actor, plan.id, {
      name: "Giáo án A",
      stages: [
        {
          stageId: w.rehab.id,
          sessions: [{ week: 1, number: 1, items: [{ exerciseId: w.squat.id, sets: [{ weight: "30", reps: "10" }] }] }],
        },
      ],
    });
    await submitPlan(w.pt.actor, plan.id);
    await approveRequest(w.master, (await pendingOf(plan.id)).id);
    return getPlan(w.pt.actor, plan.id);
  }

  it("sends an empty plan nowhere", async () => {
    const w = await world();
    const plan = await createPlan(w.pt.actor, customerPlan(w));

    await expect(submitPlan(w.pt.actor, plan.id)).rejects.toMatchObject({ fieldErrors: { stages: ["emptyPlan"] } });
    expect(await prisma.approvalRequest.count({ where: { actionType: "workout.plan" } })).toBe(0);
  });

  it("goes back to its writer when the Master rejects it, and can be edited and sent again", async () => {
    const w = await world();
    const plan = await createPlan(w.pt.actor, customerPlan(w));
    const content = {
      name: "x",
      stages: [
        {
          stageId: w.rehab.id,
          sessions: [{ week: 1, number: 1, items: [{ exerciseId: w.squat.id, sets: [{ reps: "5" }] }] }],
        },
      ],
    };
    await updatePlan(w.pt.actor, plan.id, content);
    await submitPlan(w.pt.actor, plan.id);

    await rejectRequest(w.master, (await pendingOf(plan.id)).id, { reasonId: REJECT, reasonNote: "Thiếu khởi động" });

    expect(await getPlan(w.pt.actor, plan.id)).toMatchObject({ status: "REJECTED", can: { edit: true, submit: true } });
    await updatePlan(w.pt.actor, plan.id, { ...content, name: "Đã sửa" });
    await submitPlan(w.pt.actor, plan.id);
    await approveRequest(w.master, (await pendingOf(plan.id)).id);
    expect(await getPlan(w.pt.actor, plan.id)).toMatchObject({ status: "APPROVED", name: "Đã sửa" });
  });

  it("is a revision when an approved plan changes: one at a time, and the plan in use is replaced only when it is approved", async () => {
    const w = await world();
    const plan = await approvedPlan(w);

    const revision = await revisePlan(w.pt.actor, plan.id);
    expect(revision).toMatchObject({ status: "DRAFT", previousPlanId: plan.id, name: "Giáo án A", sessions: 1 });
    expect(revision.stages[0]!.sessions[0]!.items[0]!.sets[0]).toMatchObject({ weight: 30, reps: 10 });
    expect(await getPlan(w.pt.actor, plan.id)).toMatchObject({
      status: "APPROVED",
      revisionId: revision.id,
      can: { revise: false },
    });
    await expect(revisePlan(w.pt.actor, plan.id)).rejects.toMatchObject({ code: "PLAN_NOT_EDITABLE" });
    await expect(revisePlan(w.pt.actor, revision.id)).rejects.toMatchObject({ code: "PLAN_NOT_APPROVED" });

    await updatePlan(w.pt.actor, revision.id, {
      name: "Giáo án A v2",
      stages: [
        {
          stageId: w.rehab.id,
          sessions: [{ week: 1, number: 1, items: [{ exerciseId: w.squat.id, sets: [{ weight: "35", reps: "10" }] }] }],
        },
      ],
    });
    await submitPlan(w.pt.actor, revision.id);
    // Waiting: the first plan is still the one in use.
    expect((await getPlan(w.pt.actor, plan.id)).status).toBe("APPROVED");
    await approveRequest(w.master, (await pendingOf(revision.id)).id);

    expect(await getPlan(w.pt.actor, plan.id)).toMatchObject({
      status: "SUPERSEDED",
      can: { edit: false, revise: false },
    });
    expect(await getPlan(w.pt.actor, revision.id)).toMatchObject({ status: "APPROVED", name: "Giáo án A v2" });
    // Replaced once; the new plan can be revised in turn.
    await expect(revisePlan(w.pt.actor, plan.id)).rejects.toMatchObject({ code: "PLAN_NOT_APPROVED" });
    await expect(revisePlan(w.pt.actor, revision.id)).resolves.toMatchObject({ status: "DRAFT" });
  });

  it("two revisions at once make one", async () => {
    const w = await world();
    const plan = await approvedPlan(w);

    const results = await Promise.allSettled(
      [1, 2, 3].map(() => revisePlan(w.pt.actor, plan.id)).map((promise) => promise),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.workoutPlan.count({ where: { previousPlanId: plan.id } })).toBe(1);
  });

  it("two submissions at once make one request", async () => {
    const w = await world();
    const plan = await createPlan(w.pt.actor, customerPlan(w));
    await updatePlan(w.pt.actor, plan.id, {
      name: "x",
      stages: [
        { stageId: w.rehab.id, sessions: [{ week: 1, number: 1, items: [{ exerciseId: w.squat.id, sets: [] }] }] },
      ],
    });

    await Promise.allSettled([
      submitPlan(w.pt.actor, plan.id),
      submitPlan(w.pt.actor, plan.id),
      submitPlan(w.pt.actor, plan.id),
    ]);

    expect(await prisma.approvalRequest.count({ where: { actionType: "workout.plan", entityId: plan.id } })).toBe(1);
  });

  it("is approved at once when the matrix does not ask for the Master", async () => {
    const w = await world();
    await withoutApprovals();
    const plan = await createPlan(w.pt.actor, customerPlan(w));
    await updatePlan(w.pt.actor, plan.id, {
      name: "x",
      stages: [
        { stageId: w.rehab.id, sessions: [{ week: 1, number: 1, items: [{ exerciseId: w.squat.id, sets: [] }] }] },
      ],
    });

    const sent = await submitPlan(w.pt.actor, plan.id);

    expect(sent).toMatchObject({ status: "APPROVED", approvedBy: { id: w.pt.actor.id } });
    expect(await prisma.approvalRequest.count({ where: { actionType: "workout.plan" } })).toBe(0);
  });
});

describe("reviews (brief §7.2)", () => {
  it("are the coach's and the Master's own, written while the plan waits and after it is approved", async () => {
    const w = await world();
    const plan = await createPlan(w.pt.actor, customerPlan(w));
    await updatePlan(w.pt.actor, plan.id, {
      name: "x",
      stages: [
        { stageId: w.rehab.id, sessions: [{ week: 1, number: 1, items: [{ exerciseId: w.squat.id, sets: [] }] }] },
      ],
    });
    await submitPlan(w.pt.actor, plan.id);

    await reviewPlan(w.pt.actor, plan.id, { side: "PT", evaluation: "Khách tiến bộ", note: "Tăng tạ tuần 3" });
    await approveRequest(w.master, (await pendingOf(plan.id)).id);
    const reviewed = await reviewPlan(w.master, plan.id, {
      side: "MASTER",
      evaluation: "Đạt",
      note: "Theo dõi đầu gối",
    });

    expect(reviewed).toMatchObject({
      ptEvaluation: "Khách tiến bộ",
      ptNote: "Tăng tạ tuần 3",
      masterEvaluation: "Đạt",
      masterNote: "Theo dõi đầu gối",
      can: { reviewAsMaster: true },
    });
    await expect(reviewPlan(w.pt.actor, plan.id, { side: "MASTER", evaluation: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const stranger = await linkedTrainer(w.manager, "PT Hoa");
    await expect(reviewPlan(stranger.actor, plan.id, { side: "PT", evaluation: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      await prisma.auditEvent.count({ where: { entityId: plan.id, action: { startsWith: "workout_plan." } } }),
    ).toBeGreaterThan(3);
  });
});

describe("who sees and writes plans", () => {
  it("shows a PT their own customers' plans and every template, a manager the branch's, and nobody else's branch", async () => {
    const w = await world();
    const mine = await createPlan(w.pt.actor, customerPlan(w));
    const theirs = await createPlan(w.manager, customerPlan(w, { trainerId: w.trainer.id }));
    const template = await createPlan(w.admin, { kind: "TEMPLATE", name: "Template", branchId: "" });
    const stranger = await linkedTrainer(w.manager, "PT Hoa");

    const ids = async (actor: World["admin"], query: Record<string, string> = {}) =>
      (await listPlans(actor, query)).items.map((item) => item.id).sort();

    expect(await ids(w.pt.actor)).toEqual([mine.id, template.id].sort());
    expect(await ids(stranger.actor)).toEqual([template.id]);
    expect(await ids(w.manager)).toEqual([mine.id, theirs.id, template.id].sort());
    expect(await ids(w.manager, { kind: "CUSTOMER", trainerId: w.trainer.id })).toEqual([theirs.id]);
    expect(await ids(w.manager, { kind: "TEMPLATE" })).toEqual([template.id]);
    expect(await ids(w.manager, { q: "an" })).toEqual([mine.id, theirs.id].sort());
    await expect(getPlan(stranger.actor, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updatePlan(stranger.actor, mine.id, { name: "x", stages: [] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(submitPlan(stranger.actor, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const other = await createTestBranch();
    const { actor: elsewhere } = await createTestUser("ADMIN", { branchIds: [other.id] });
    expect(await ids(elsewhere)).toEqual([]);
    await expect(getPlan(elsewhere, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(DEFAULT_BRANCH_ID).toBeDefined();
  });

  it("is written by Admin, the manager and the PT; read by the Master; and closed to reception, consulting and accounting", async () => {
    const w = await world();
    const template = await createPlan(w.admin, { kind: "TEMPLATE", name: "Template", branchId: "" });

    for (const role of ["MASTER", "RECEPTIONIST", "CONSULTING", "ACCOUNTANT", "MARKETING"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      await expect(createPlan(actor, { kind: "TEMPLATE", name: "x", branchId: "" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(updatePlan(actor, template.id, { name: "x", stages: [] })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    for (const role of ["RECEPTIONIST", "CONSULTING", "ACCOUNTANT", "MARKETING"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      await expect(listPlans(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await listPlans(w.master, {})).total).toBe(1);
  });

  it("refuses bad ids and bad inputs with a field error, never a server error", async () => {
    const w = await world();

    await expect(getPlan(w.admin, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updatePlan(w.admin, randomUUID(), { name: "x", stages: [] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(createPlan(w.admin, { kind: "OTHER" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(createPlan(w.admin, { kind: "TEMPLATE", name: "", branchId: "" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(listPlans(w.admin, { status: "DONE" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const template = await createPlan(w.admin, { kind: "TEMPLATE", name: "T", branchId: "" });
    await expect(
      updatePlan(w.admin, template.id, { name: "x", stages: [{ stageId: randomUUID(), sessions: [] }] }),
    ).rejects.toMatchObject({
      fieldErrors: { "stages.0.stageId": ["invalidChoice"] },
    });
    await expect(updatePlan(w.admin, template.id, { name: "a\u0007b", stages: [] })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
