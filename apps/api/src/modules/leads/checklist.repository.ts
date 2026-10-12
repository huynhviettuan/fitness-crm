import type { Prisma, StepTiming } from "../../generated/prisma/client.js";
import type { ChecklistData } from "@flow/shared/leads";
import type { Db } from "../../platform/db/prisma.js";

const person = { select: { id: true, name: true } } as const;

const checklistInclude = {
  steps: { orderBy: { sortOrder: "asc" } },
} as const satisfies Prisma.ConsultingChecklistInclude;

export type ChecklistRecord = Prisma.ConsultingChecklistGetPayload<{ include: typeof checklistInclude }>;

const stepInclude = { template: true, doneBy: person } as const satisfies Prisma.LeadStepInclude;

export type LeadStepRecord = Prisma.LeadStepGetPayload<{ include: typeof stepInclude }>;

/** The newest version: what new leads get. */
export function latestChecklist(db: Db): Promise<ChecklistRecord | null> {
  return db.consultingChecklist.findFirst({ orderBy: { version: "desc" }, include: checklistInclude });
}

/** Who saved a version (kept without a foreign key, schema.prisma). */
export function findPerson(db: Db, id: string | null): Promise<{ id: string; name: string } | null> {
  return id ? db.user.findUnique({ where: { id }, select: { id: true, name: true } }) : Promise.resolve(null);
}

/** Serializes saving, so two admins never make the same version number. */
export async function lockChecklist(db: Db): Promise<void> {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('consulting-checklist'))::text AS locked`;
}

export function createChecklist(
  db: Db,
  version: number,
  createdById: string,
  data: ChecklistData,
): Promise<ChecklistRecord> {
  return db.consultingChecklist.create({
    data: {
      version,
      createdById,
      steps: { create: data.steps.map((step, index) => ({ ...step, sortOrder: index + 1 })) },
    },
    include: checklistInclude,
  });
}

/** A new lead gets every step of the newest version, waiting (D-020). */
export async function startChecklist(db: Db, customerId: string): Promise<void> {
  const checklist = await latestChecklist(db);
  if (!checklist) return;
  await db.customer.update({ where: { id: customerId }, data: { checklistId: checklist.id } });
  await db.leadStep.createMany({ data: checklist.steps.map((step) => ({ customerId, templateId: step.id })) });
}

export async function leadVersion(db: Db, customerId: string): Promise<number | null> {
  const lead = await db.customer.findUnique({
    where: { id: customerId },
    select: { checklist: { select: { version: true } } },
  });
  return lead?.checklist?.version ?? null;
}

export function leadSteps(db: Db, customerId: string): Promise<LeadStepRecord[]> {
  return db.leadStep.findMany({
    where: { customerId },
    include: stepInclude,
    orderBy: { template: { sortOrder: "asc" } },
  });
}

export function openSteps(db: Db, customerId: string): Promise<LeadStepRecord[]> {
  return db.leadStep.findMany({ where: { customerId, doneAt: null, lockedAt: null }, include: stepInclude });
}

/** Opens a step with its deadline, or moves the deadline; a new deadline is told about again. */
export async function setDeadline(db: Db, step: LeadStepRecord, dueAt: Date, at: Date): Promise<void> {
  if (step.dueAt?.getTime() === dueAt.getTime()) return;
  await db.leadStep.update({
    where: { id: step.id },
    data: { openedAt: step.openedAt ?? at, dueAt, dueNotifiedAt: null },
  });
}

/** Back to waiting: what opened it no longer holds (e.g. the appointment was called off). */
export async function closeStep(db: Db, step: LeadStepRecord): Promise<void> {
  if (!step.openedAt) return;
  await db.leadStep.update({ where: { id: step.id }, data: { openedAt: null, dueAt: null, dueNotifiedAt: null } });
}

export function completeStep(
  db: Db,
  id: string,
  data: {
    doneAt: Date;
    doneById: string | null;
    resultIndex: number;
    note: string | null;
    timing: StepTiming;
    openedAt?: Date;
    dueAt?: Date;
  },
): Promise<LeadStepRecord> {
  return db.leadStep.update({ where: { id }, data, include: stepInclude });
}

/** Holds the step's row until the transaction ends, so a tick and the lock never cross (D-054). */
export async function lockStepRow(db: Db, id: string): Promise<void> {
  await db.$queryRaw`SELECT "id" FROM "lead_steps" WHERE "id" = ${id}::uuid FOR UPDATE`;
}

/**
 * Locks as "Không thực hiện" the steps still open `graceMinutes` after their deadline (D-054) and
 * returns them, for the history. A lead's own steps only when `customerId` is given.
 */
export function lockOverdue(db: Db, now: Date, graceMinutes: number, customerId: string | null = null) {
  return db.$queryRaw<{ id: string; customer_id: string; template_id: string; due_at: Date }[]>`
    UPDATE "lead_steps" SET "locked_at" = ${now}
    WHERE "done_at" IS NULL AND "locked_at" IS NULL AND "due_at" IS NOT NULL
      AND "due_at" + make_interval(mins => ${graceMinutes}::int) < ${now}
      AND (${customerId}::uuid IS NULL OR "customer_id" = ${customerId}::uuid)
    RETURNING "id", "customer_id", "template_id", "due_at"`;
}

/** The step is open again after admin removed its tick (D-054); its deadline is never earlier than now. */
export function reopenStep(db: Db, id: string, dueAt: Date): Promise<LeadStepRecord> {
  return db.leadStep.update({
    where: { id },
    data: {
      doneAt: null,
      doneById: null,
      resultIndex: null,
      note: null,
      timing: null,
      lockedAt: null,
      dueAt,
      dueNotifiedAt: null,
    },
    include: stepInclude,
  });
}

export function findLeadStep(db: Db, customerId: string, id: string): Promise<LeadStepRecord | null> {
  return db.leadStep.findFirst({ where: { id, customerId }, include: stepInclude });
}

/** Open steps due before `until`, of leads matching `leads`, oldest deadline first. */
export function dueSteps(db: Db, leads: Prisma.CustomerWhereInput, until: Date, take: number) {
  return db.leadStep.findMany({
    where: { doneAt: null, lockedAt: null, dueAt: { lt: until }, customer: leads },
    include: {
      ...stepInclude,
      customer: { select: { id: true, leadCode: true, fullName: true, leadStatus: true, pic: person } },
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take,
  });
}

/** Marks the steps that came due and were not told about yet; returns them for the telling. */
export function claimDueSteps(db: Db, now: Date) {
  return db.$queryRaw<
    {
      customer_id: string;
      lead_code: string;
      full_name: string;
      pic_user_id: string;
      label_vi: string;
      label_en: string;
    }[]
  >`
    UPDATE "lead_steps" AS s SET "due_notified_at" = ${now}
    FROM "customers" AS c, "consulting_step_templates" AS t
    WHERE s."customer_id" = c."id" AND s."template_id" = t."id"
      AND s."done_at" IS NULL AND s."due_at" <= ${now} AND s."due_notified_at" IS NULL
      AND c."stage" = 'LEAD' AND c."merged_into_id" IS NULL AND c."pic_user_id" IS NOT NULL
    RETURNING c."id" AS customer_id, c."lead_code", c."full_name", c."pic_user_id", t."label_vi", t."label_en"`;
}
