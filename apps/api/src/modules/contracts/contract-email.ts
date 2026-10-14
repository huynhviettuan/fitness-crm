import { EMAIL_EVENTS, emailLocaleFor, type EmailEvent, type EmailLocale, type EmailValues } from "@flow/shared/mail";
import { entitledSessions, valueOfContract } from "@flow/shared/contracts";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { sumValidPayments } from "../finance/payment.repository.js";
import { queueEmail } from "../mail/mail.service.js";
import { isEventSent, renderEmail } from "../mail/template.service.js";
import { formatDay } from "../sessions/session-email.js";
import { findContract, usedSessionsOf } from "./contract.repository.js";

// The optional customer emails about a contract (M6.3, D-036, D-059; A-181, A-182): activated or renewed, a receipt, on
// hold, active again, cancelled, ending soon, running out of sessions. Each is queued in the transaction of the change,
// once per cause, in the language of the customer's nationality group, from the admin's template, and only when Admin
// has the event on. A customer with no address is skipped quietly: these are not the mandatory emails that raise a task
// for reception (D-036).

export type ContractEmailEvent = Extract<
  EmailEvent,
  | "contract.activated"
  | "contract.renewed"
  | "payment.received"
  | "contract.deactivated"
  | "contract.reactivated"
  | "contract.cancelled"
  | "contract.expiring"
  | "contract.runningOut"
  | "change.renewal"
  | "change.hold"
  | "change.upgrade"
  | "change.conversion"
  | "change.transferOut"
  | "change.transferIn"
  | "change.branchTransfer"
>;

/** An amount in dong as the customer reads it: 3.000.000 ₫ in Vietnamese, VND 3,000,000 in English. */
export function moneyText(amount: number, locale: EmailLocale): string {
  return locale === "vi"
    ? `${new Intl.NumberFormat("vi-VN").format(amount)} ₫`
    : `VND ${new Intl.NumberFormat("en-US").format(amount)}`;
}

type Cause = {
  event: ContractEmailEvent;
  /** The row whose change this is; one email per cause and event. */
  causeId: string;
  contractId: string;
  by: string | null;
  /** The gym day the change counts from; today when not given. */
  day?: Date;
  reason?: { labelVi: string; labelEn: string; note: string | null };
  payment?: { receiptNumber: string; amount: number };
  addedDays?: number;
  daysLeft?: number;
  /** What a change voucher says to the customer (M8): its number, what it added, its days and amount. */
  voucher?: {
    voucherNumber: string;
    sessionsAdded: number;
    fromDate: Date | null;
    toDate: Date | null;
    amount: number | null;
    /** An upgrade or a conversion: the service exchanged for. */
    targetService?: string;
    /** A transfer: the other customer; a branch transfer: the new branch. */
    otherParty?: string;
    targetBranch?: string;
  };
};

/** Queues the email of one change to a contract; nothing when the event is off or the customer has no address. */
export async function queueContractEmail(tx: Db, cause: Cause): Promise<void> {
  if (!(await isEventSent(tx, cause.event))) return;
  const contract = await findContract(tx, cause.contractId, {});
  if (!contract) throw new AppError("NOT_FOUND");
  const customer = await tx.customer.findUnique({
    where: { id: contract.customerId },
    select: { fullName: true, email: true, countryCode: true },
  });
  if (!customer) throw new AppError("NOT_FOUND");
  // A customer with no address is skipped quietly, except for a mandatory event: that one is queued and fails with a task
  // for reception (D-036).
  if (!customer.email?.trim() && !EMAIL_EVENTS[cause.event].mandatory) return;

  const locale = emailLocaleFor(customer.countryCode);
  const entitled = entitledSessions(contract.totalSessions, contract.bonusSessions, contract.voucherSessions);
  const remaining = entitled - contract.openingSessionsUsed - usedSessionsOf(contract);
  const value = valueOfContract(Number(contract.contractValue), Number(contract.voucherValue));
  const paid = Number(contract.openingPaidAmount) + (await sumValidPayments(tx, { contractId: contract.id }));
  const values: EmailValues = {
    customerName: customer.fullName,
    contractCode: contract.contractCode,
    packageName: contract.packageName,
    startDate: formatDay(contract.startDate),
    endDate: formatDay(contract.endDate),
    totalSessions: entitled,
    remaining,
    day: formatDay(cause.day ?? calendarDateInTimeZone(env.GYM_TIMEZONE)),
    amount: moneyText(cause.payment?.amount ?? cause.voucher?.amount ?? value, locale),
    paidTotal: moneyText(paid, locale),
    debt: moneyText(Math.max(0, value - paid), locale),
    receiptNumber: cause.payment?.receiptNumber ?? "",
    reason: cause.reason ? (cause.reason.note ?? (locale === "vi" ? cause.reason.labelVi : cause.reason.labelEn)) : "",
    addedDays: cause.addedDays ?? 0,
    daysLeft: cause.daysLeft ?? 0,
    voucherNumber: cause.voucher?.voucherNumber ?? "",
    targetService: cause.voucher?.targetService ?? "",
    otherParty: cause.voucher?.otherParty ?? "",
    targetBranch: cause.voucher?.targetBranch ?? "",
    sessionsAdded: cause.voucher?.sessionsAdded ?? 0,
    fromDate: cause.voucher?.fromDate ? formatDay(cause.voucher.fromDate) : "",
    toDate: cause.voucher?.toDate ? formatDay(cause.voucher.toDate) : "",
  };
  const rendered = await renderEmail(tx, cause.event, locale, values);
  if (!rendered) return;
  await queueEmail(tx, {
    personId: contract.customerId,
    event: cause.event,
    dedupeKey: `${cause.event}:${cause.causeId}`,
    locale,
    subject: rendered.subject,
    body: rendered.body,
    by: cause.by,
  });
}

/**
 * Tells customers whose contract ends within `expiringSoonDays`, or has `runningOutSessions` sessions left or fewer,
 * once each (D-012, A-023, A-025); the worker runs it every hour. An event that is off is not looked at, and the
 * customer is told once its switch goes on (the dedupe key is the contract's end date, or the contract).
 */
export async function emailContractNotices(now: Date = new Date()): Promise<number> {
  const today = calendarDateInTimeZone(env.GYM_TIMEZONE, now);
  let queued = 0;
  if (await isEventSent(prisma, "contract.expiring")) {
    const days = Number(await readParameter(prisma, "expiringSoonDays"));
    const last = new Date(today.getTime() + days * 86_400_000);
    const ending = await prisma.contract.findMany({
      where: { status: "ACTIVE", deletedAt: null, endDate: { gte: today, lte: last } },
      select: { id: true, endDate: true },
    });
    for (const contract of ending) {
      const daysLeft = Math.round((contract.endDate.getTime() - today.getTime()) / 86_400_000);
      await queueContractEmail(prisma, {
        event: "contract.expiring",
        causeId: `${contract.id}:${contract.endDate.toISOString().slice(0, 10)}`,
        contractId: contract.id,
        by: null,
        daysLeft,
      });
      queued += 1;
    }
  }
  if (await isEventSent(prisma, "contract.runningOut")) {
    const sessions = Number(await readParameter(prisma, "runningOutSessions"));
    const running = await prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM contracts c
      WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE' AND c.end_date >= ${today}::date
        AND c.total_sessions + c.bonus_sessions + c.voucher_sessions - c.opening_sessions_used
            - (SELECT COUNT(*) FROM bookings k WHERE k.contract_id = c.id AND k.consumes)
            - (SELECT COUNT(*) FROM class_attendances a WHERE a.contract_id = c.id AND a.consumes)
            <= ${sessions}::int`;
    for (const contract of running) {
      await queueContractEmail(prisma, {
        event: "contract.runningOut",
        causeId: contract.id,
        contractId: contract.id,
        by: null,
      });
      queued += 1;
    }
  }
  return queued;
}
