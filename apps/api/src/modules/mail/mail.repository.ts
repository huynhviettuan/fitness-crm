import type { Db } from "../../platform/db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export type EmailRecord = Prisma.EmailMessageGetPayload<object>;

export type EmailInsert = {
  personId: string;
  branchId: string;
  event: string;
  dedupeKey: string;
  toAddress: string | null;
  locale: string;
  subject: string;
  body: string;
  createdById: string | null;
};

/** Nothing is added when the cause already has its email (the unique key); returns the row either way. */
export async function insertEmail(db: Db, data: EmailInsert): Promise<{ email: EmailRecord; created: boolean }> {
  const { count } = await db.emailMessage.createMany({ data: [data], skipDuplicates: true });
  const email = await db.emailMessage.findUniqueOrThrow({ where: { dedupeKey: data.dedupeKey } });
  return { email, created: count === 1 };
}

/**
 * Takes the emails that are due for one worker: they move `lease` ahead and count the attempt, so another worker
 * (or the next minute) skips them while this one is sending, and a worker that dies leaves them to be retried.
 */
export async function claimDue(db: Db, now: Date, lease: Date, limit: number): Promise<EmailRecord[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "email_messages"
    WHERE "status" = 'QUEUED' AND "next_attempt_at" <= ${now}
    ORDER BY "next_attempt_at"
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED`;
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  await db.emailMessage.updateMany({
    where: { id: { in: ids } },
    data: { attempts: { increment: 1 }, nextAttemptAt: lease },
  });
  return db.emailMessage.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: "asc" } });
}

export function markSent(db: Db, id: string, providerMessageId: string | null, at: Date) {
  return db.emailMessage.updateMany({
    where: { id, status: "QUEUED" },
    data: { status: "SENT", sentAt: at, providerMessageId, failure: null },
  });
}

export function scheduleRetry(db: Db, id: string, failure: string, at: Date) {
  return db.emailMessage.updateMany({
    where: { id, status: "QUEUED" },
    data: { failure, nextAttemptAt: at },
  });
}

/** Moves a queued email to failed once; false when it already left the queue. */
export async function markFailed(db: Db, id: string, failure: string): Promise<boolean> {
  const { count } = await db.emailMessage.updateMany({
    where: { id, status: "QUEUED" },
    data: { status: "FAILED", failure },
  });
  return count === 1;
}

export function attachFailureTask(db: Db, id: string, taskId: string) {
  return db.emailMessage.update({ where: { id }, data: { failureTaskId: taskId } });
}

export async function listForPerson(db: Db, personId: string, page: { skip: number; take: number }) {
  const where: Prisma.EmailMessageWhereInput = { personId };
  const [items, total] = await Promise.all([
    db.emailMessage.findMany({ where, orderBy: { createdAt: "desc" }, ...page }),
    db.emailMessage.count({ where }),
  ]);
  return { items, total };
}

export function findPerson(db: Db, id: string) {
  return db.customer.findUnique({
    where: { id },
    select: { id: true, branchId: true, fullName: true, customerCode: true, leadCode: true, email: true },
  });
}

/** Who a failure task is assigned by when the email has no author: the longest-serving active all-branch user. */
export function findFallbackAuthor(db: Db) {
  return db.user.findFirst({
    where: { status: "ACTIVE", allBranches: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}

export type TemplateRecord = Prisma.EmailTemplateGetPayload<{ include: { updatedBy: { select: { name: true } } } }>;

export function listTemplates(db: Db): Promise<TemplateRecord[]> {
  return db.emailTemplate.findMany({ include: { updatedBy: { select: { name: true } } } });
}

export function findTemplate(db: Db, event: string): Promise<TemplateRecord | null> {
  return db.emailTemplate.findUnique({ where: { event }, include: { updatedBy: { select: { name: true } } } });
}

export function saveTemplate(
  db: Db,
  event: string,
  data: { subjectVi: string; bodyVi: string; subjectEn: string; bodyEn: string; enabled?: boolean },
  by: string,
): Promise<TemplateRecord> {
  return db.emailTemplate.upsert({
    where: { event },
    create: { event, ...data, updatedById: by, updatedAt: new Date() },
    update: { ...data, updatedById: by, updatedAt: new Date() },
    include: { updatedBy: { select: { name: true } } },
  });
}
