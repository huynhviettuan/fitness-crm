import {
  allocationPerSession,
  allocationValueOf,
  bookingReportQuerySchema,
  entitledSessions,
  ptAllocation,
  ptRevenueQuerySchema,
  type BookingReportPage,
  type BookingReportRow,
  type Overview,
  type PtRevenueReport,
  type PtRevenueRow,
  type PtRevenueTrainer,
} from "@gymcrm/shared/reports";
import { periodReportQuerySchema } from "@gymcrm/shared/finance";
import type { DataScopeResource, Permission } from "@gymcrm/shared/permissions";
import { percentOf } from "@gymcrm/shared/contracts";
import type { StatusColor } from "@gymcrm/shared/bookings";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { env } from "../../platform/env.js";
import { prisma } from "../../platform/db/prisma.js";
import type { Actor } from "../../platform/auth/session.js";
import { assertCan, forbidden } from "../../platform/permissions/assert.js";
import { isMasked } from "../../platform/permissions/scope.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { parseInput } from "../../platform/validation/parse.js";
import { startOfGymDay, bookingsVisibleTo } from "../bookings/booking.service.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { adjustmentFor } from "@gymcrm/shared/payouts";
import * as payoutRepo from "../payouts/payout.repository.js";
import * as repo from "./pt-report.repository.js";
import { assertWholeScope, branchesOf, periodOf } from "./report-scope.js";

// The PT revenue allocation report, the booking report, and the overview dashboard (brief §6.5, §9; M5.6, A-166 to
// A-172). The screens and the Excel files call these functions, so the figures are the same everywhere.

const DAY = 86_400_000;

/**
 * The PT revenue allocation of a period (D-032): one row per PT and contract with the sessions that credited the PT,
 * the allocation, and totals per PT. The pay is money, so a role whose receipt totals are hidden is refused (D-017),
 * and so is one whose data scope is "own": a report over only some of the records would mislead.
 */
export async function ptRevenueReport(actor: Actor, rawQuery: unknown): Promise<PtRevenueReport> {
  assertCan(actor, "report.ptRevenue");
  assertWholeScope(actor, "schedule", "report.ptRevenue");
  if (isMasked(actor, "receipts.totals")) throw forbidden(actor, "report.ptRevenue", "maskedMoney");
  const query = parseInput(ptRevenueQuerySchema, rawQuery);
  const { from, to } = periodOf(query);
  const branches = branchesOf(actor, query.branchId);
  const timesheetRate = Number(await readParameter(prisma, "ptTimesheetRate"));
  const [credited, classes] = await Promise.all([
    repo.creditedRows(prisma, branches, { from, to }, env.GYM_TIMEZONE, query.trainerId),
    repo.taughtClasses(prisma, branches, { from, to }, env.GYM_TIMEZONE, query.trainerId),
  ]);
  const hidePhone = isMasked(actor, "customer.phone");

  const trainers = new Map<string, PtRevenueTrainer>();
  const trainerOf = (id: string, employeeCode: string, fullName: string) => {
    let trainer = trainers.get(id);
    if (!trainer) {
      trainer = {
        employee: { id, employeeCode, fullName },
        rows: [],
        credited: 0,
        inShift: 0,
        outsideShift: 0,
        classSessions: 0,
        allocation: 0,
        payable: 0,
        adjustments: 0,
      };
      trainers.set(id, trainer);
    }
    return trainer;
  };

  for (const row of credited) {
    const trainer = trainerOf(row.trainerId, row.employeeCode, row.trainerName);
    const allocationValue = allocationValueOf(row.contractValue, row.vatAmount);
    const sessions = entitledSessions(row.totalSessions, row.bonusSessions);
    const line: PtRevenueRow = {
      customer: {
        id: row.customerId,
        customerCode: row.customerCode,
        fullName: row.customerName,
        phone: hidePhone ? null : row.phone,
      },
      branch: { id: row.branchId, name: row.branchName },
      contract: {
        id: row.contractId,
        contractCode: row.contractCode,
        service: row.serviceId && row.serviceName ? { id: row.serviceId, name: row.serviceName } : null,
        contractType: row.contractType,
        contractValue: row.contractValue,
        note: row.note,
      },
      allocationValue,
      sessions,
      allocationPerSession: allocationPerSession(allocationValue, sessions),
      credited: row.credited,
      inShift: row.inShift,
      outsideShift: row.credited - row.inShift,
      commissionRate: row.commissionRate,
      timesheetRate,
      allocation: ptAllocation({
        credited: row.credited,
        allocationValue,
        sessions,
        commissionRate: row.commissionRate,
        timesheetRate,
      }),
      paidSessions: row.paid,
      payable: ptAllocation({
        credited: row.credited - row.paid,
        allocationValue,
        sessions,
        commissionRate: row.commissionRate,
        timesheetRate,
      }),
      adjustments: 0,
    };
    trainer.rows.push(line);
    trainer.credited += line.credited;
    trainer.inShift += line.inShift;
    trainer.outsideShift += line.outsideShift;
    trainer.allocation += line.allocation;
    trainer.payable += line.payable;
  }
  // Paid sessions deleted from the history since are taken back in the PT's next payout (D-027, A-173).
  const pending = await payoutRepo.pendingAdjustments(prisma, branches, query.trainerId);
  const unknown = [...new Set(pending.map((item) => item.trainerId))].filter((id) => !trainers.has(id));
  const people = await prisma.employee.findMany({
    where: { id: { in: unknown } },
    select: { id: true, employeeCode: true, fullName: true },
  });
  for (const person of people) trainerOf(person.id, person.employeeCode, person.fullName);
  for (const item of pending) {
    const trainer = trainers.get(item.trainerId);
    if (!trainer) continue;
    const taken = adjustmentFor(item.paid);
    trainer.adjustments += taken;
    trainer.payable += taken;
    const line = trainer.rows.find((candidate) => candidate.contract.id === item.contractId);
    if (line) line.adjustments += taken;
  }
  for (const taught of classes) {
    trainerOf(taught.coachId, taught.employeeCode, taught.coachName).classSessions = taught.sessions;
  }

  const sorted = [...trainers.values()]
    .map((trainer) => ({
      ...trainer,
      rows: trainer.rows.sort(
        (a, b) =>
          a.contract.contractCode.localeCompare(b.contract.contractCode) ||
          a.customer.customerCode.localeCompare(b.customer.customerCode),
      ),
    }))
    .sort((a, b) => a.employee.employeeCode.localeCompare(b.employee.employeeCode));
  return {
    from,
    to,
    trainers: sorted,
    totals: {
      credited: sorted.reduce((sum, trainer) => sum + trainer.credited, 0),
      classSessions: sorted.reduce((sum, trainer) => sum + trainer.classSessions, 0),
      allocation: sorted.reduce((sum, trainer) => sum + trainer.allocation, 0),
      payable: sorted.reduce((sum, trainer) => sum + trainer.payable, 0),
      adjustments: sorted.reduce((sum, trainer) => sum + trainer.adjustments, 0),
    },
  };
}

/** The first moment after a gym day, for a range that includes the whole last day. */
function startOfNextDay(day: Date): Date {
  return startOfGymDay(new Date(day.getTime() + DAY));
}

function toBookingRow(record: repo.BookingReportRecord, hidePhone: boolean): BookingReportRow {
  return {
    id: record.id,
    type: record.addedByHand ? "BURN_SHOW" : "PT",
    customer: {
      id: record.customer.id,
      customerCode: record.customer.customerCode ?? "",
      fullName: record.customer.fullName,
      phone: hidePhone ? null : record.customer.phone,
    },
    contract: record.contract,
    branch: record.branch,
    staff: record.trainer,
    status: { ...record.statusRule, color: record.statusRule.color as StatusColor },
    scheduledStart: record.scheduledStart,
    scheduledEnd: record.scheduledEnd,
    checkedInAt: record.session?.checkedInAt ?? null,
    checkedOutAt: record.session?.completedAt ?? null,
    createdAt: record.createdAt,
  };
}

/**
 * The booking report (brief §9): the PT sessions of a period with customer, phone (masked when hidden), check-in and
 * check-out times, status, PT, and created date; filtered by type and status. Sessions deleted by mistake or from the
 * history are in the trash, not here (D-035).
 */
export async function bookingReport(actor: Actor, rawQuery: unknown): Promise<BookingReportPage> {
  assertCan(actor, "report.bookings");
  assertWholeScope(actor, "schedule", "report.bookings");
  const query = parseInput(bookingReportQuerySchema, rawQuery);
  const { from, to } = periodOf(query);
  const branches = branchesOf(actor, query.branchId);
  const where: Prisma.BookingWhereInput = {
    AND: [
      bookingsVisibleTo(actor),
      branches === "ALL" ? {} : { branchId: { in: branches } },
      { scheduledStart: { gte: startOfGymDay(from), lt: startOfNextDay(to) } },
      query.trainerId ? { trainerId: query.trainerId } : {},
      query.status ? { status: query.status } : {},
      query.type ? { addedByHand: query.type === "BURN_SHOW" } : {},
    ],
  };
  const { items, total } = await repo.bookingReportPage(prisma, where, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  const hidePhone = isMasked(actor, "customer.phone");
  return {
    items: items.map((item) => toBookingRow(item, hidePhone)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

const OVERVIEW_SCOPES: [DataScopeResource, Permission][] = [
  ["leads", "report.overview"],
  ["schedule", "report.overview"],
  ["contracts", "report.overview"],
];

/** The twelve months up to the month of `last`, as "YYYY-MM". */
function twelveMonths(last: Date): { first: Date; months: string[] } {
  const months: string[] = [];
  for (let back = 11; back >= 0; back--) {
    const month = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - back, 1));
    months.push(`${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return { first: new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - 11, 1)), months };
}

/**
 * The overview dashboard (docs/10, A-172): new leads and their conversion, members training, active PTs, contracts
 * ending soon, PT sessions by the hour of the day, and the revenue of the last twelve months. Revenue is left out
 * for a role whose receipt totals are hidden (D-017); a role whose scope is "own" gets no overview, as its figures
 * would be partial.
 */
export async function overview(actor: Actor, rawQuery: unknown): Promise<Overview> {
  assertCan(actor, "report.overview");
  for (const [resource, permission] of OVERVIEW_SCOPES) assertWholeScope(actor, resource, permission);
  const query = parseInput(periodReportQuerySchema, rawQuery);
  const { from, to } = periodOf(query);
  const branches = branchesOf(actor, query.branchId);
  const [expiringSoonDays, runningOutSessions] = (
    await Promise.all([readParameter(prisma, "expiringSoonDays"), readParameter(prisma, "runningOutSessions")])
  ).map(Number) as [number, number];
  const showRevenue = !isMasked(actor, "receipts.totals");
  const months = twelveMonths(to);
  const lastYear = to.getUTCFullYear();
  const years = [lastYear - 2, lastYear - 1, lastYear].map(String);
  const [figures, hours, revenue, yearly] = await Promise.all([
    repo.overviewFigures(prisma, branches, { from, to }, env.GYM_TIMEZONE, {
      today: calendarDateInTimeZone(env.GYM_TIMEZONE),
      expiringSoonDays,
      runningOutSessions,
    }),
    repo.sessionsByHour(prisma, branches, { from, to }, env.GYM_TIMEZONE),
    showRevenue
      ? repo.revenueByMonth(prisma, branches, {
          from: months.first,
          to: new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)),
        })
      : Promise.resolve(null),
    showRevenue
      ? repo.revenueByYear(prisma, branches, {
          from: new Date(Date.UTC(lastYear - 2, 0, 1)),
          to: new Date(Date.UTC(lastYear, 11, 31)),
        })
      : Promise.resolve(null),
  ]);
  return {
    from,
    to,
    newLeads: figures.newLeads,
    convertedLeads: figures.convertedLeads,
    conversionRate: percentOf(figures.convertedLeads, figures.newLeads),
    membersTraining: figures.membersTraining,
    activePts: figures.activePts,
    endingSoon: figures.endingSoon,
    expiringSoonDays,
    runningOutSessions,
    sessionsByHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      sessions: hours.find((entry) => entry.hour === hour)?.sessions ?? 0,
    })),
    revenueByMonth: revenue
      ? months.months.map((month) => ({ month, revenue: revenue.find((entry) => entry.month === month)?.revenue ?? 0 }))
      : null,
    revenueByYear: yearly
      ? years.map((year) => ({ year, revenue: yearly.find((entry) => entry.year === year)?.revenue ?? 0 }))
      : null,
  };
}
