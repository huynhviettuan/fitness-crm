import type { Db } from "../../platform/db/prisma.js";
import type { Prisma, SourceType } from "../../generated/prisma/client.js";
import { chosenSelect } from "../../platform/options/option.service.js";

// Inquiries and merges of person records (BR-202, D-019, A-063..A-067): data access only.

const person = { select: { id: true, name: true } } as const;

const inquiryInclude = {
  createdBy: person,
  channel: { select: chosenSelect },
  source: { select: chosenSelect },
  needGroup: { select: chosenSelect },
} as const satisfies Prisma.LeadInquiryInclude;

export type InquiryRecord = Prisma.LeadInquiryGetPayload<{ include: typeof inquiryInclude }>;

export type InquiryWrite = {
  personId: string;
  branchId: string;
  createdById: string;
  channelId: string;
  channelNote: string | null;
  sourceId: string | null;
  sourceNote: string | null;
  sourceType: SourceType | null;
  sourceDetail: string | null;
  needGroupId: string | null;
  needGroupNote: string | null;
  needDetail: string | null;
  note: string | null;
};

export function createInquiry(db: Db, data: InquiryWrite): Promise<InquiryRecord> {
  return db.leadInquiry.create({ data, include: inquiryInclude });
}

export function inquiriesOf(db: Db, personId: string): Promise<InquiryRecord[]> {
  return db.leadInquiry.findMany({
    where: { personId },
    include: inquiryInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

const mergeInclude = {
  mergedBy: person,
  reason: { select: chosenSelect },
  merged: { select: { fullName: true, leadCode: true, customerCode: true } },
} as const satisfies Prisma.PersonMergeInclude;

export type MergeRecord = Prisma.PersonMergeGetPayload<{ include: typeof mergeInclude }>;

/** The merges into this record, newest first. */
export function mergesInto(db: Db, survivorId: string): Promise<MergeRecord[]> {
  return db.personMerge.findMany({
    where: { survivorId },
    include: mergeInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

/** A record with everything a merge reads, and the counts that must be zero on the merged one. */
export function findForMerge(db: Db, id: string) {
  return db.customer.findUnique({
    where: { id },
    include: { _count: { select: { contracts: true, bookings: true } } },
  });
}

/** Holds both records until the transaction ends, so two merges of a pair (or of one record) never interleave. */
export async function lockPair(db: Db, ids: [string, string]): Promise<void> {
  const [first, second] = [...ids].sort();
  for (const id of [first, second]) {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`merge:${id}`}))::text AS locked`;
  }
  await db.$queryRaw`SELECT "id" FROM "customers" WHERE "id" IN (${first}::uuid, ${second}::uuid) ORDER BY "id" FOR UPDATE`;
}

/** Marks the record merged; its phone moves to the survivor (database check customers_merged_consistent). */
export function markMerged(db: Db, id: string, survivorId: string, at: Date) {
  return db.customer.update({ where: { id }, data: { mergedIntoId: survivorId, mergedAt: at, phone: null } });
}

export function fillSurvivor(db: Db, id: string, fill: Record<string, unknown>) {
  return db.customer.update({ where: { id }, data: fill as Prisma.CustomerUncheckedUpdateInput });
}

export function addMerge(
  db: Db,
  data: {
    survivorId: string;
    mergedId: string;
    reasonId: string;
    reasonNote: string | null;
    mergedById: string;
    before: Prisma.InputJsonValue;
  },
) {
  return db.personMerge.create({ data: { ...data } });
}

/** Moves the history and work that belonged to the merged record to the survivor (A-067). Returns what moved. */
export async function moveChildren(
  db: Db,
  mergedId: string,
  survivor: { id: string; stage: "LEAD" | "CUSTOMER" },
  closedBy: string,
  at: Date,
): Promise<{
  statusChanges: number;
  assignments: number;
  inquiries: number;
  steps: number;
  closedSteps: number;
  tasks: number;
  messages: number;
}> {
  const statusChanges = (
    await db.leadStatusChange.updateMany({ where: { customerId: mergedId }, data: { customerId: survivor.id } })
  ).count;
  const assignments = (
    await db.leadAssignment.updateMany({ where: { customerId: mergedId }, data: { customerId: survivor.id } })
  ).count;
  const inquiries = (
    await db.leadInquiry.updateMany({ where: { personId: mergedId }, data: { personId: survivor.id } })
  ).count;
  // The conversation received through the lead channels (M10.1, M10.3): a Messenger sender merged into the customer it turned out
  // to be keeps writing to that customer (A-279).
  const messages = (
    await db.intakeMessage.updateMany({ where: { personId: mergedId }, data: { personId: survivor.id } })
  ).count;

  // A step of a template the survivor already has stays on the merged record: closed "merged" when open.
  const have = new Set(
    (await db.leadStep.findMany({ where: { customerId: survivor.id }, select: { templateId: true } })).map(
      (s) => s.templateId,
    ),
  );
  const steps = await db.leadStep.findMany({ where: { customerId: mergedId } });
  let moved = 0;
  let closedSteps = 0;
  for (const step of steps) {
    if (!have.has(step.templateId)) {
      await db.leadStep.update({ where: { id: step.id }, data: { customerId: survivor.id } });
      moved += 1;
    } else if (!step.doneAt) {
      await db.leadStep.update({
        where: { id: step.id },
        data: {
          doneAt: at,
          doneById: closedBy,
          note: "merged",
          openedAt: step.openedAt ?? at,
          dueAt: step.dueAt ?? at,
          timing: "ON_TIME",
        },
      });
      closedSteps += 1;
    }
  }

  const type = survivor.stage === "LEAD" ? "lead" : "customer";
  const tasks = await db.$executeRaw`
    UPDATE "tasks" SET "entity_type" = ${type}, "entity_id" = ${survivor.id}::uuid
    WHERE "entity_id" = ${mergedId}::uuid AND "entity_type" IN ('lead', 'customer')`;
  const path = survivor.stage === "LEAD" ? "leads" : "customers";
  await db.$executeRaw`
    UPDATE "notifications" SET "link" = ${`/${path}/${survivor.id}`}
    WHERE "link" = ${`/leads/${mergedId}`} OR "link" = ${`/customers/${mergedId}`}`;
  return { statusChanges, assignments, inquiries, steps: moved, closedSteps, tasks, messages };
}
