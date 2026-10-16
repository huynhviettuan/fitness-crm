import { z } from "zod";
import {
  canEditPlan,
  canRevisePlan,
  expandTemplate,
  foreignFields,
  numberWeeksAcrossStages,
  planContentSchema,
  planCreateSchema,
  planListQuerySchema,
  planReviewSchema,
  plannedSessions,
  type Plan,
  type PlanPage,
  type PlanStatus,
  type SetTargets,
} from "@gymcrm/shared/workouts";
import { calendarDateInTimeZone, normalizeForSearch } from "@gymcrm/shared/validation";
import type { Prisma } from "../../generated/prisma/client.js";
import { ruleFor, submitForApproval } from "../../platform/approvals/approval.engine.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import type { Actor } from "../../platform/auth/session.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { hasBranch, inBranches, isOwnOnly, resolveBranch } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import { findContract } from "../contracts/contract.repository.js";
import { contractsVisibleTo } from "../contracts/contract.service.js";
import * as repo from "./plan.repository.js";

// Workout plans and templates (M7.2, brief §7.1, §7.2, FR-WKO-001, FR-WKO-002, D-033, D-018; A-192 to A-198). A plan is
// written as a draft, goes to the Master, and is then never edited: a change is a revision that replaces it when approved.
// A PT writes and sees only their own customers' plans (data scope "schedule"); managers and reviewers see the branch's.

const uuid = z.uuid();
const notFound = () => new AppError("NOT_FOUND");
const invalid = (field: string, code = "invalidChoice") =>
  new AppError("VALIDATION_FAILED", { fieldErrors: { [field]: [code] } });
const gymToday = () => calendarDateInTimeZone(env.GYM_TIMEZONE);

/** The plans an actor may see: their branches' templates, and customer plans (a PT's own only, A-29). */
function visibleTo(actor: Actor): Prisma.WorkoutPlanWhereInput {
  const own: Prisma.WorkoutPlanWhereInput = {
    OR: [
      { kind: "TEMPLATE" },
      ...(actor.employeeId ? [{ trainerId: actor.employeeId }] : []),
      { createdById: actor.id },
    ],
  };
  return { AND: [inBranches(actor), isOwnOnly(actor, "schedule") ? own : {}] };
}

/** Whether the actor may change this plan: a PT only their own, a manager any in their branches. */
function mayWrite(actor: Actor, plan: { kind: string; trainerId: string | null; createdById: string }): boolean {
  if (!actor.permissions.has("workout.plan")) return false;
  if (!isOwnOnly(actor, "schedule")) return true;
  return plan.createdById === actor.id || (plan.trainerId !== null && plan.trainerId === actor.employeeId);
}

const personName = (value: { id: string; name: string } | null) => (value ? { id: value.id, name: value.name } : null);

function toView(record: repo.PlanRecord, actor: Actor, pendingRequestId: string | null): Plan {
  const status = record.status as PlanStatus;
  const writer = mayWrite(actor, record);
  const open = record.revisions.find((revision) => revision.status === "DRAFT" || revision.status === "PENDING");
  const customerPlan = record.kind === "CUSTOMER";
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    status,
    active: record.active,
    branch: record.branch,
    customer: record.customer
      ? { id: record.customer.id, customerCode: record.customer.customerCode ?? "", fullName: record.customer.fullName }
      : null,
    contract: record.contract,
    trainer: record.trainer,
    planDate: record.planDate,
    sessions: plannedSessions(record.stages),
    previousPlanId: record.previousPlanId,
    updatedAt: record.updatedAt,
    phase: record.phase,
    goal: record.goal,
    notes: record.notes,
    sourceTemplate: record.sourceTemplate,
    ptEvaluation: record.ptEvaluation,
    ptNote: record.ptNote,
    masterEvaluation: record.masterEvaluation,
    masterNote: record.masterNote,
    createdBy: record.createdBy,
    approvedBy: personName(record.approvedBy),
    approvedAt: record.approvedAt,
    revisionId: open?.id ?? record.revisions[0]?.id ?? null,
    pendingRequestId,
    can: {
      edit: writer && canEditPlan(status),
      submit: writer && canEditPlan(status),
      revise: writer && canRevisePlan(status) && !open,
      reviewAsPt:
        customerPlan &&
        status !== "SUPERSEDED" &&
        (actor.permissions.has("workout.review") ||
          (record.trainerId !== null && record.trainerId === actor.employeeId)),
      reviewAsMaster: customerPlan && status !== "SUPERSEDED" && actor.permissions.has("workout.review"),
    },
    stages: record.stages.map((stage) => ({
      id: stage.id,
      stage: stage.stage,
      sessions: stage.sessions.map((session) => ({
        id: session.id,
        week: session.week,
        number: session.number,
        goal: session.goal,
        items: session.items.map((item) => ({
          id: item.id,
          exercise: {
            id: item.exercise.id,
            name: item.exercise.name,
            kind: item.exercise.kind,
            videoUrl: item.exercise.videoUrl,
            equipmentName: item.exercise.equipment?.name ?? null,
          },
          sets: item.sets.map((set) => ({
            id: set.id,
            setNo: set.setNo,
            weight: set.weight === null ? null : Number(set.weight),
            reps: set.reps,
            restSeconds: set.restSeconds,
            rir: set.rir,
            tempo: set.tempo,
            technique: set.technique,
            videoUrl: set.videoUrl,
            durationMinutes: set.durationMinutes === null ? null : Number(set.durationMinutes),
            speed: set.speed === null ? null : Number(set.speed),
            heartRate: set.heartRate,
            notes: set.notes,
          })),
        })),
      })),
    })),
  };
}

async function pendingRequest(db: Db, planId: string): Promise<string | null> {
  const request = await db.approvalRequest.findFirst({
    where: { actionType: "workout.plan", entityId: planId, status: "PENDING" },
    select: { id: true },
  });
  return request?.id ?? null;
}

async function viewOf(db: Db, actor: Actor, id: string): Promise<Plan> {
  const record = await repo.findPlan(db, { AND: [{ id }, visibleTo(actor)] });
  if (!record) throw notFound();
  return toView(record, actor, await pendingRequest(db, id));
}

// ------------------------------------------------------------------------------------------------------ reading

export async function listPlans(actor: Actor, rawQuery: unknown): Promise<PlanPage> {
  assertCan(actor, "workout.view");
  const query = parseInput(planListQuerySchema, rawQuery);
  const search = normalizeForSearch(query.q);
  const where: Prisma.WorkoutPlanWhereInput = {
    AND: [
      visibleTo(actor),
      {
        kind: query.kind,
        status: query.status,
        customerId: query.customerId,
        trainerId: query.trainerId,
        // Retired templates are left out unless asked for; a customer plan is replaced, not retired.
        active: query.includeInactive ? undefined : true,
        ...(search
          ? {
              OR: [
                { name: { contains: query.q, mode: "insensitive" } },
                { customer: { searchName: { contains: search } } },
              ],
            }
          : {}),
      },
    ],
  };
  const { items, total } = await repo.listPlans(prisma, where, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return {
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      status: item.status as PlanStatus,
      active: item.active,
      branch: item.branch,
      customer: item.customer
        ? { id: item.customer.id, customerCode: item.customer.customerCode ?? "", fullName: item.customer.fullName }
        : null,
      contract: item.contract,
      trainer: item.trainer,
      planDate: item.planDate,
      sessions: item.sessionCount,
      previousPlanId: item.previousPlanId,
      updatedAt: item.updatedAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getPlan(actor: Actor, id: string): Promise<Plan> {
  assertCan(actor, "workout.view");
  if (!uuid.safeParse(id).success) throw notFound();
  return viewOf(prisma, actor, id);
}

// ----------------------------------------------------------------------------------------------------- creating

/** The coach of a new customer plan: a PT's own, or the trainer a manager names (an active employee who teaches PT). */
async function resolveTrainer(tx: Db, actor: Actor, requested: string | null, branchId: string) {
  const id = actor.employeeId && isOwnOnly(actor, "schedule") ? actor.employeeId : (requested ?? actor.employeeId);
  if (!id) throw invalid("trainerId", "required");
  const trainer = await tx.employee.findUnique({
    where: { id },
    select: { id: true, isTrainer: true, status: true, branchId: true },
  });
  if (!trainer || !trainer.isTrainer || trainer.status !== "ACTIVE" || trainer.branchId !== branchId) {
    throw invalid("trainerId");
  }
  if (isOwnOnly(actor, "schedule") && trainer.id !== actor.employeeId) throw new AppError("FORBIDDEN");
  return trainer.id;
}

/** The content of an approved template, as the stages to copy. */
async function templateContent(tx: Db, templateId: string, branchId: string): Promise<repo.StageData[]> {
  const template = await repo.findPlan(tx, { id: templateId, kind: "TEMPLATE" });
  if (!template || template.status !== "APPROVED" || !template.active || template.branchId !== branchId) {
    throw invalid("templateId");
  }
  return template.stages.map((stage) => ({
    stageId: stage.stageId,
    sessions: stage.sessions.map((session) => ({
      week: null,
      number: null,
      goal: session.goal,
      items: session.items.map((item) => ({
        exerciseId: item.exerciseId,
        sets: item.sets.map((set) => ({
          weight: set.weight === null ? null : Number(set.weight),
          reps: set.reps,
          restSeconds: set.restSeconds,
          rir: set.rir,
          tempo: set.tempo,
          technique: set.technique,
          videoUrl: set.videoUrl,
          durationMinutes: set.durationMinutes === null ? null : Number(set.durationMinutes),
          speed: set.speed === null ? null : Number(set.speed),
          heartRate: set.heartRate,
          notes: set.notes,
        })),
      })),
    })),
  }));
}

/** A new template, or a customer's plan (blank, or from an approved template of the branch). Always a draft. */
export async function createPlan(actor: Actor, rawInput: unknown): Promise<Plan> {
  assertCan(actor, "workout.plan");
  const input = parseInput(planCreateSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    if (input.kind === "TEMPLATE") {
      const branchId = await resolveBranch(tx, actor, input.branchId);
      const created = await repo.createPlan(tx, {
        kind: "TEMPLATE",
        name: input.name,
        branchId,
        notes: input.notes,
        planDate: gymToday(),
        createdById: actor.id,
      });
      await auditCreated(tx, actor, created.id, { kind: "TEMPLATE", name: input.name });
      return viewOf(tx, actor, created.id);
    }

    // The contract is the customer's own, approved (active or on hold), and in a branch the actor works in.
    const contract = await findContract(tx, input.contractId, contractsVisibleTo(actor));
    if (!contract || contract.customerId !== input.customerId || !["ACTIVE", "FROZEN"].includes(contract.status)) {
      throw invalid("contractId");
    }
    if (!hasBranch(actor, contract.branchId)) throw invalid("contractId");
    const trainerId = await resolveTrainer(tx, actor, input.trainerId, contract.branchId);
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: contract.customerId },
      select: { fullName: true },
    });
    const stages = input.templateId
      ? numberWeeksAcrossStages(
          expandTemplate(
            await templateContent(tx, input.templateId, contract.branchId),
            input.weeksPerStage,
            input.sessionsPerWeek,
          ),
        )
      : [];
    const created = await repo.createPlan(tx, {
      kind: "CUSTOMER",
      name: input.name ?? `Giáo án ${customer.fullName}`,
      branchId: contract.branchId,
      customerId: contract.customerId,
      contractId: contract.id,
      trainerId,
      planDate: gymToday(),
      sourceTemplateId: input.templateId,
      createdById: actor.id,
    });
    await repo.writeStages(tx, created.id, stages);
    await auditCreated(tx, actor, created.id, {
      kind: "CUSTOMER",
      customerId: contract.customerId,
      contractId: contract.id,
      trainerId,
      templateId: input.templateId,
      sessions: plannedSessions(stages),
    });
    return viewOf(tx, actor, created.id);
  });
}

function auditCreated(tx: Db, actor: Actor, id: string, after: Record<string, unknown>) {
  return recordAudit(tx, {
    actorUserId: actor.id,
    entityType: "workout_plan",
    entityId: id,
    action: "workout_plan.created",
    after: { ...after, status: "DRAFT" },
  });
}

// ------------------------------------------------------------------------------------------------------- saving

/** What a save checks about the exercises, stages, and numbering; the shape was checked by the schema. */
async function checkContent(tx: Db, plan: { id: string; kind: string }, stages: repo.StageData[]): Promise<void> {
  const used = await repo.usedIds(tx, plan.id);
  const exerciseIds = [
    ...new Set(stages.flatMap((stage) => stage.sessions.flatMap((s) => s.items.map((i) => i.exerciseId)))),
  ];
  const exercises = await tx.workoutExercise.findMany({
    where: { id: { in: exerciseIds } },
    select: { id: true, kind: true, active: true },
  });
  const kinds = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const catalog = await tx.workoutStage.findMany({
    where: { id: { in: [...new Set(stages.map((stage) => stage.stageId))] } },
    select: { id: true, active: true },
  });
  const known = new Map(catalog.map((stage) => [stage.id, stage]));

  const seenStages = new Set<string>();
  const seenSessions = new Set<string>();
  for (const [stageIndex, stage] of stages.entries()) {
    const entry = known.get(stage.stageId);
    if (!entry || (!entry.active && !used.stages.has(stage.stageId))) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { [`stages.${stageIndex}.stageId`]: ["invalidChoice"] } });
    }
    if (seenStages.has(stage.stageId)) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { [`stages.${stageIndex}.stageId`]: ["duplicate"] } });
    }
    seenStages.add(stage.stageId);
    if (plan.kind === "TEMPLATE" && stage.sessions.length > 1) {
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { [`stages.${stageIndex}.sessions`]: ["templateOneSession"] },
      });
    }
    for (const [sessionIndex, session] of stage.sessions.entries()) {
      const at = `stages.${stageIndex}.sessions.${sessionIndex}`;
      if (plan.kind === "TEMPLATE" && (session.week !== null || session.number !== null)) {
        throw new AppError("VALIDATION_FAILED", { fieldErrors: { [`${at}.week`]: ["templateHasNoWeeks"] } });
      }
      if (plan.kind === "CUSTOMER") {
        if (session.week === null)
          throw new AppError("VALIDATION_FAILED", { fieldErrors: { [`${at}.week`]: ["required"] } });
        if (session.number === null)
          throw new AppError("VALIDATION_FAILED", { fieldErrors: { [`${at}.number`]: ["required"] } });
        const key = `${session.week}:${session.number}`;
        if (seenSessions.has(key))
          throw new AppError("VALIDATION_FAILED", { fieldErrors: { [`${at}.number`]: ["duplicate"] } });
        seenSessions.add(key);
      }
      for (const [itemIndex, item] of session.items.entries()) {
        const exercise = kinds.get(item.exerciseId);
        const where = `${at}.items.${itemIndex}`;
        if (!exercise || (!exercise.active && !used.exercises.has(item.exerciseId))) {
          throw new AppError("VALIDATION_FAILED", { fieldErrors: { [`${where}.exerciseId`]: ["invalidChoice"] } });
        }
        for (const [setIndex, set] of item.sets.entries()) {
          const foreign = foreignFields(exercise.kind, set as Partial<SetTargets>);
          if (foreign.length > 0) {
            throw new AppError("VALIDATION_FAILED", {
              fieldErrors: { [`${where}.sets.${setIndex}.${foreign[0]}`]: ["notForThisExercise"] },
            });
          }
        }
      }
    }
  }
}

/** The numbers an audit event keeps of a plan's content. */
const countsOf = (stages: { sessions: { items: { sets: unknown[] }[] }[] }[]) => ({
  stages: stages.length,
  sessions: stages.reduce((sum, stage) => sum + stage.sessions.length, 0),
  exercises: stages.reduce((sum, stage) => sum + stage.sessions.reduce((n, s) => n + s.items.length, 0), 0),
  sets: stages.reduce(
    (sum, stage) => sum + stage.sessions.reduce((n, s) => n + s.items.reduce((m, i) => m + i.sets.length, 0), 0),
    0,
  ),
});

/**
 * Saves a plan's header and everything under it as one (FR-WKO-002). Only a draft, or a plan sent back, is edited; the
 * Strength fields go on Strength exercises and the Cardio fields on Cardio ones (brief §7.2); a template has one session per
 * stage and no weeks, a customer plan numbers its sessions by week.
 */
export async function updatePlan(actor: Actor, id: string, rawInput: unknown): Promise<Plan> {
  assertCan(actor, "workout.plan");
  if (!uuid.safeParse(id).success) throw notFound();
  const input = parseInput(planContentSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockPlan(tx, id))) throw notFound();
    const before = await repo.findPlan(tx, { AND: [{ id }, visibleTo(actor)] });
    if (!before || !mayWrite(actor, before)) throw notFound();
    if (!canEditPlan(before.status as PlanStatus)) throw new AppError("PLAN_NOT_EDITABLE");

    const stages: repo.StageData[] = input.stages.map((stage) => ({
      stageId: stage.stageId,
      sessions: stage.sessions.map((session) => ({
        week: session.week,
        number: session.number,
        goal: session.goal,
        items: session.items.map((item) => ({ exerciseId: item.exerciseId, sets: item.sets })),
      })),
    }));
    await checkContent(tx, before, stages);
    await repo.clearStages(tx, id);
    await repo.writeStages(tx, id, stages);
    await repo.updatePlan(tx, id, {
      name: input.name,
      phase: input.phase,
      goal: input.goal,
      notes: input.notes,
      active: before.kind === "TEMPLATE" ? input.active : undefined,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "workout_plan",
      entityId: id,
      action: "workout_plan.updated",
      before: { name: before.name, phase: before.phase, goal: before.goal, ...countsOf(before.stages) },
      after: { name: input.name, phase: input.phase, goal: input.goal, ...countsOf(stages) },
    });
    return viewOf(tx, actor, id);
  }, LOCKING_TRANSACTION);
}

// ------------------------------------------------------------------------------------- approval and revisions

/** Makes a plan APPROVED, and the one it revises SUPERSEDED. Runs in the transaction of the decision or of the submission. */
async function approve(tx: Db, plan: { id: string; previousPlanId: string | null }, approverId: string) {
  await repo.updatePlan(tx, plan.id, { status: "APPROVED", approvedById: approverId, approvedAt: new Date() });
  if (plan.previousPlanId) await repo.updatePlan(tx, plan.previousPlanId, { status: "SUPERSEDED", active: false });
}

/**
 * Sends a draft to the Master. When the matrix does not require it (an admin switched it off), the plan is approved at
 * once. Empty plans are not sent: nothing would be approved.
 */
export async function submitPlan(actor: Actor, id: string): Promise<Plan> {
  assertCan(actor, "workout.plan");
  if (!uuid.safeParse(id).success) throw notFound();
  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockPlan(tx, id))) throw notFound();
    const plan = await repo.findPlan(tx, { AND: [{ id }, visibleTo(actor)] });
    if (!plan || !mayWrite(actor, plan)) throw notFound();
    if (!canEditPlan(plan.status as PlanStatus)) throw new AppError("PLAN_NOT_EDITABLE");
    if (counts(plan).exercises === 0) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { stages: ["emptyPlan"] } });
    }
    const rule = await ruleFor(tx, "workout.plan");
    if (rule.required) {
      await repo.updatePlan(tx, id, { status: "PENDING" });
      await submitForApproval(tx, actor, {
        action: "workout.plan",
        entityType: "workout_plan",
        entityId: id,
        branchId: plan.branchId,
        title: titleOf(plan),
        amount: null,
        payload: { kind: plan.kind },
      });
    } else {
      await approve(tx, plan, actor.id);
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "workout_plan",
      entityId: id,
      action: rule.required ? "workout_plan.submitted" : "workout_plan.approved",
      before: { status: plan.status },
      after: { status: rule.required ? "PENDING" : "APPROVED" },
    });
    return viewOf(tx, actor, id);
  }, LOCKING_TRANSACTION);
}

function counts(plan: repo.PlanRecord) {
  return countsOf(plan.stages);
}

function titleOf(plan: { name: string; customer: { fullName: string } | null }): string {
  return plan.customer ? `${plan.name} · ${plan.customer.fullName}` : plan.name;
}

/**
 * The Master's decision on a plan (D-018), run by the approvals inbox. Approved, the plan is the one in use and the plan it
 * revises is replaced; rejected, it goes back to its writer to be edited.
 */
export async function decidePlan(
  tx: Db,
  decider: Pick<Actor, "id">,
  id: string,
  to: "APPROVED" | "REJECTED",
): Promise<void> {
  const plan = await tx.workoutPlan.findUnique({
    where: { id },
    select: { id: true, status: true, previousPlanId: true },
  });
  if (!plan) throw notFound();
  if (plan.status !== "PENDING") throw new AppError("APPROVAL_NOT_PENDING");
  if (to === "APPROVED") await approve(tx, plan, decider.id);
  else await repo.updatePlan(tx, id, { status: "REJECTED" });
  await recordAudit(tx, {
    actorUserId: decider.id,
    entityType: "workout_plan",
    entityId: id,
    action: to === "APPROVED" ? "workout_plan.approved" : "workout_plan.rejected",
    before: { status: "PENDING" },
    after: { status: to },
  });
}

/** Locks the plan before its request is decided, so a decision and an edit never overlap. */
export function lockPlanForDecision(tx: Db, id: string) {
  return repo.lockPlan(tx, id);
}

/**
 * Starts a revision of an approved plan: a draft copy that replaces it when approved (D-022 for plans). One revision at a
 * time; the plan in use stays in use until then.
 */
export async function revisePlan(actor: Actor, id: string): Promise<Plan> {
  assertCan(actor, "workout.plan");
  if (!uuid.safeParse(id).success) throw notFound();
  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockPlan(tx, id))) throw notFound();
    const plan = await repo.findPlan(tx, { AND: [{ id }, visibleTo(actor)] });
    if (!plan || !mayWrite(actor, plan)) throw notFound();
    if (!canRevisePlan(plan.status as PlanStatus)) throw new AppError("PLAN_NOT_APPROVED");
    if (plan.revisions.some((revision) => revision.status === "DRAFT" || revision.status === "PENDING")) {
      throw new AppError("PLAN_NOT_EDITABLE");
    }
    const created = await repo.createPlan(tx, {
      kind: plan.kind,
      name: plan.name,
      branchId: plan.branchId,
      customerId: plan.customerId,
      contractId: plan.contractId,
      trainerId: plan.trainerId,
      planDate: gymToday(),
      phase: plan.phase,
      goal: plan.goal,
      notes: plan.notes,
      active: plan.active,
      sourceTemplateId: plan.sourceTemplateId,
      previousPlanId: plan.id,
      createdById: actor.id,
    });
    await repo.writeStages(
      tx,
      created.id,
      plan.stages.map((stage) => ({
        stageId: stage.stageId,
        sessions: stage.sessions.map((session) => ({
          week: session.week,
          number: session.number,
          goal: session.goal,
          items: session.items.map((item) => ({
            exerciseId: item.exerciseId,
            sets: item.sets.map((set) => ({
              weight: set.weight === null ? null : Number(set.weight),
              reps: set.reps,
              restSeconds: set.restSeconds,
              rir: set.rir,
              tempo: set.tempo,
              technique: set.technique,
              videoUrl: set.videoUrl,
              durationMinutes: set.durationMinutes === null ? null : Number(set.durationMinutes),
              speed: set.speed === null ? null : Number(set.speed),
              heartRate: set.heartRate,
              notes: set.notes,
            })),
          })),
        })),
      })),
    );
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "workout_plan",
      entityId: created.id,
      action: "workout_plan.revision_started",
      after: { status: "DRAFT", previousPlanId: plan.id },
    });
    return viewOf(tx, actor, created.id);
  }, LOCKING_TRANSACTION);
}

// ------------------------------------------------------------------------------------------------------ reviews

/**
 * The coach's and the Master's evaluations and notes (brief §7.2). They are not part of the approved content, so they
 * can be written while a plan waits and after it is approved, and each side writes only its own.
 */
export async function reviewPlan(actor: Actor, id: string, rawInput: unknown): Promise<Plan> {
  assertCan(actor, "workout.view");
  if (!uuid.safeParse(id).success) throw notFound();
  const input = parseInput(planReviewSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockPlan(tx, id))) throw notFound();
    const plan = await repo.findPlan(tx, { AND: [{ id }, visibleTo(actor)] });
    if (!plan || plan.kind !== "CUSTOMER" || plan.status === "SUPERSEDED") throw notFound();
    const view = toView(plan, actor, null);
    if (input.side === "PT" ? !view.can.reviewAsPt : !view.can.reviewAsMaster) throw new AppError("FORBIDDEN");
    const data =
      input.side === "PT"
        ? { ptEvaluation: input.evaluation, ptNote: input.note }
        : { masterEvaluation: input.evaluation, masterNote: input.note };
    await repo.updatePlan(tx, id, data);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "workout_plan",
      entityId: id,
      action: input.side === "PT" ? "workout_plan.pt_reviewed" : "workout_plan.master_reviewed",
      before:
        input.side === "PT"
          ? { evaluation: plan.ptEvaluation, note: plan.ptNote }
          : { evaluation: plan.masterEvaluation, note: plan.masterNote },
      after: { evaluation: input.evaluation, note: input.note },
    });
    return viewOf(tx, actor, id);
  });
}
