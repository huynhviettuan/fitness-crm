import { z } from "zod";
import {
  EMAIL_LOCALES,
  EVENT_KEY_PATTERN,
  listEmailsSchema,
  nextAttemptAt,
  type EmailFailure,
  type EmailLocale,
  type EmailMessage,
  type EmailMessagePage,
} from "@flow/shared/mail";
import { hasNoControlCharacters } from "@flow/shared/validation";
import type { Actor } from "../../platform/auth/session.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { isMasked } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import { findCustomer } from "../customers/customer.repository.js";
import { visibleTo } from "../customers/customer.service.js";
import { createMailFailureTask } from "../tasks/task.service.js";
import { configuredMailProvider, type MailProvider } from "./mail.provider.js";
import * as repo from "./mail.repository.js";

// Customer email (D-036, D-059). A feature that must tell a customer something calls `queueEmail` in the transaction
// of the change, so a rolled-back change sends nothing; the worker's `sendDueEmails` sends the queue. The rows are
// the customer's "Emails sent" tab (FR-MAIL-003). What the email says (templates in vi and en) is M6.2; this is the
// sending, the retries, and the task when an email finally fails.

/** How many emails one run takes, and how long a taken email is left alone while it is being sent. */
const BATCH_SIZE = 20;
const LEASE_MS = 10 * 60_000;

const queueEmailSchema = z.object({
  personId: z.uuid(),
  event: z.string().regex(EVENT_KEY_PATTERN).max(80),
  dedupeKey: z.string().min(1).max(200),
  locale: z.enum(EMAIL_LOCALES),
  // One line without control characters: a line break in the subject could add headers to the message.
  subject: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(hasNoControlCharacters, { error: "invalidCharacters" })
    .regex(/^[^\r\n\t]*$/, { error: "invalidCharacters" }),
  body: z.string().min(1).max(20_000),
  by: z.uuid().nullable(),
});

export type QueueEmailInput = z.input<typeof queueEmailSchema> & { locale: EmailLocale };

/**
 * Queues one email to a customer, once per `dedupeKey` (name the cause, e.g. "session.credited:<session id>"), so a
 * retried request or job adds none. A customer without an email address gets a failed row and a task for reception
 * instead of silence. `by` is the user whose action caused it.
 */
export async function queueEmail(db: Db, input: QueueEmailInput): Promise<void> {
  const data = parseInput(queueEmailSchema, input);
  const person = await repo.findPerson(db, data.personId);
  if (!person) throw new AppError("NOT_FOUND");
  const toAddress = person.email?.trim() || null;
  const { email, created } = await repo.insertEmail(db, {
    personId: person.id,
    branchId: person.branchId,
    event: data.event,
    dedupeKey: data.dedupeKey,
    toAddress,
    locale: data.locale,
    subject: data.subject,
    body: data.body,
    createdById: data.by,
  });
  if (created && !toAddress) await fail(db, email, "noEmail", new Date());
}

export type SendReport = { sent: number; retried: number; failed: number };

/** Sends the emails that are due; a failure retries later (1, 5, 30 minutes) and then stays failed with a task. */
export async function sendDueEmails(
  now: Date = new Date(),
  provider: MailProvider = configuredMailProvider(),
): Promise<SendReport> {
  const claimed = await prisma.$transaction((tx) =>
    repo.claimDue(tx, now, new Date(now.getTime() + LEASE_MS), BATCH_SIZE),
  );
  const report: SendReport = { sent: 0, retried: 0, failed: 0 };
  for (const email of claimed) {
    // No address was already settled when it was queued; this guards a row edited since.
    const result = email.toAddress
      ? await provider.send({
          to: email.toAddress,
          subject: email.subject,
          body: email.body,
          idempotencyKey: email.id,
        })
      : ({ ok: false, failure: "noEmail", retry: false } as const);
    if (result.ok) {
      await repo.markSent(prisma, email.id, result.providerMessageId, now);
      report.sent += 1;
      continue;
    }
    const again = result.retry ? nextAttemptAt(email.attempts, now) : null;
    if (again) {
      await repo.scheduleRetry(prisma, email.id, result.failure, again);
      report.retried += 1;
    } else {
      await prisma.$transaction((tx) => fail(tx, email, result.failure, now));
      report.failed += 1;
    }
  }
  return report;
}

const REASONS: Record<EmailFailure, string> = {
  noEmail: "khách chưa có địa chỉ email",
  providerRejected: "nhà cung cấp email từ chối",
  providerUnavailable: "nhà cung cấp email không phản hồi sau nhiều lần thử",
};

/** The email is final-failed: its status, and a task so reception tell the customer another way (FR-MAIL-003). */
async function fail(db: Db, email: repo.EmailRecord, failure: EmailFailure, now: Date): Promise<void> {
  if (!(await repo.markFailed(db, email.id, failure))) return;
  const person = await repo.findPerson(db, email.personId);
  const author = email.createdById ?? (await repo.findFallbackAuthor(db))?.id;
  if (!person || !author) return;
  const code = person.customerCode ?? person.leadCode;
  const taskId = await createMailFailureTask(db, {
    person,
    by: author,
    title: `Email không gửi được: ${person.fullName}`,
    description: [
      `Khách: ${person.fullName}${code ? ` (${code})` : ""}`,
      `Email: ${email.subject}`,
      `Lý do: ${REASONS[failure]}`,
      "Hãy báo khách bằng cách khác (gọi điện hoặc tin nhắn).",
    ].join("\n"),
    dueAt: new Date(now.getTime() + 24 * 3_600_000),
  });
  if (taskId) await repo.attachFailureTask(db, email.id, taskId);
}

/** The "Emails sent" tab of one customer, newest first; the address hides from roles that may not see emails. */
export async function listCustomerEmails(
  actor: Actor,
  customerId: string,
  rawQuery: unknown,
): Promise<EmailMessagePage> {
  assertCan(actor, "customer.view");
  const query = parseInput(listEmailsSchema, rawQuery);
  if (!z.uuid().safeParse(customerId).success) throw new AppError("NOT_FOUND");
  if (!(await findCustomer(prisma, customerId, visibleTo(actor)))) throw new AppError("NOT_FOUND");
  const hideAddress = isMasked(actor, "customer.email");
  const { items, total } = await repo.listForPerson(prisma, customerId, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return {
    items: items.map((row): EmailMessage => ({
      id: row.id,
      event: row.event,
      subject: row.subject,
      toAddress: hideAddress ? null : row.toAddress,
      locale: row.locale === "en" ? "en" : "vi",
      status: row.status,
      attempts: row.attempts,
      failure: isFailure(row.failure) ? row.failure : null,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function isFailure(value: string | null): value is EmailFailure {
  return value === "noEmail" || value === "providerRejected" || value === "providerUnavailable";
}
