import { emailLocaleFor, type EmailEvent, type EmailValues } from "@flow/shared/mail";
import { entitledSessions } from "@flow/shared/contracts";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import type { Db } from "../../platform/db/prisma.js";
import { findContract, usedSessionsOf } from "../contracts/contract.repository.js";
import { queueEmail } from "../mail/mail.service.js";
import { renderEmail } from "../mail/template.service.js";

// What a customer is told when a change moves their session count (D-036, D-059, AC-17; M6.2). The words are the
// admin's templates (FR-MAIL-001), in the language of the customer's nationality group; this loads the values and
// queues exactly one email per change, in the transaction of the change, so a replay or a rollback sends none.

/** The events that go with a booking or a class seat. */
export type SessionEmailEvent = Extract<
  EmailEvent,
  "session.credited" | "session.noShow" | "session.added" | "session.refunded" | "class.attended"
>;

type Cause = {
  event: SessionEmailEvent;
  /** The row whose change this is: one email per cause and event (the booking, or the class seat). */
  causeId: string;
  customerId: string;
  contractId: string;
  start: Date;
  trainerName: string;
  className?: string;
  /** Why a session was refunded or added by hand: the text of the chosen reason. */
  reason?: { labelVi: string; labelEn: string; note: string | null };
  by: string | null;
};

/** dd/MM/yyyy of a gym day held as UTC midnight. */
export function formatDay(day: Date): string {
  const [year, month, date] = day.toISOString().slice(0, 10).split("-");
  return `${date}/${month}/${year}`;
}

/** HH:mm of a moment on the gym's clock. */
export function formatClock(moment: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: env.GYM_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(moment);
}

/** The gym day a moment falls on, as dd/MM/yyyy. */
function gymDayText(moment: Date): string {
  const [year, month, date] = new Intl.DateTimeFormat("en-CA", { timeZone: env.GYM_TIMEZONE })
    .format(moment)
    .split("-");
  return `${date}/${month}/${year}`;
}

/** Queues the one email of a change in a customer's sessions, from the admin's template for the event. */
export async function queueSessionEmail(tx: Db, cause: Cause): Promise<void> {
  const [customer, contract] = await Promise.all([
    tx.customer.findUnique({ where: { id: cause.customerId }, select: { fullName: true, countryCode: true } }),
    findContract(tx, cause.contractId, {}),
  ]);
  if (!customer || !contract) throw new AppError("NOT_FOUND");
  // The counts are read after the change, so they are what the customer now has (D-011: sessions used before go-live count).
  const entitled = entitledSessions(contract.totalSessions, contract.bonusSessions);
  const remaining = entitled - contract.openingSessionsUsed - usedSessionsOf(contract);
  const locale = emailLocaleFor(customer.countryCode);
  const values: EmailValues = {
    customerName: customer.fullName,
    contractCode: contract.contractCode,
    packageName: contract.packageName,
    day: gymDayText(cause.start),
    time: formatClock(cause.start),
    trainerName: cause.trainerName,
    className: cause.className ?? "",
    used: entitled - remaining,
    remaining,
    reason: cause.reason ? (cause.reason.note ?? (locale === "vi" ? cause.reason.labelVi : cause.reason.labelEn)) : "",
  };
  const rendered = await renderEmail(tx, cause.event, locale, values);
  if (!rendered) return;
  const { subject, body } = rendered;
  await queueEmail(tx, {
    personId: cause.customerId,
    event: cause.event,
    dedupeKey: `${cause.event}:${cause.causeId}`,
    locale,
    subject,
    body,
    by: cause.by,
  });
}

/** The reason a person chose from an option list, as the email says it: the note for "Khác", else the option's label. */
export async function reasonText(
  db: Db,
  reason: { optionId: string; note: string | null },
): Promise<{ labelVi: string; labelEn: string; note: string | null }> {
  const option = await db.option.findUniqueOrThrow({
    where: { id: reason.optionId },
    select: { labelVi: true, labelEn: true },
  });
  return { ...option, note: reason.note };
}

/** The email of a change to one booking (credited, no-show, Burn Show, refund), once per booking and event. */
export async function queueBookingEmail(
  tx: Db,
  event: Exclude<SessionEmailEvent, "class.attended">,
  bookingId: string,
  by: string | null,
  reason?: { optionId: string; note: string | null },
): Promise<void> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      customerId: true,
      contractId: true,
      scheduledStart: true,
      trainer: { select: { fullName: true } },
    },
  });
  if (!booking) throw new AppError("NOT_FOUND");
  await queueSessionEmail(tx, {
    event,
    causeId: bookingId,
    customerId: booking.customerId,
    contractId: booking.contractId,
    start: booking.scheduledStart,
    trainerName: booking.trainer.fullName,
    reason: reason ? await reasonText(tx, reason) : undefined,
    by,
  });
}
