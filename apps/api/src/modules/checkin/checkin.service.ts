import {
  hangingReason,
  listScansSchema,
  manualReportQuerySchema,
  machineCodeSchema,
  type HangingSession,
  type MachineSubject,
  type ManualReport,
  type CheckinScanPage,
} from "@flow/shared/checkin";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { notify } from "../../platform/notifications/notification.service.js";
import { readParameters } from "../../platform/parameters/parameter.service.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches } from "../../platform/permissions/scope.js";
import { gymDaysRange } from "../../platform/time/gym-days.js";
import { parseInput } from "../../platform/validation/parse.js";
import { bookingsVisibleTo, changeLockedBooking, toBookingView } from "../bookings/booking.service.js";
import * as bookingRepo from "../bookings/booking.repository.js";
import { createHangingSessionTask } from "../tasks/task.service.js";

// Reviewing what the machines sent (M5.3b, D-070 to D-072): the sessions that lack a pair, the scans that could not
// serve a session, the PT's request for a manual confirmation, the report of confirmations by hand, and the machine
// user codes of customers and employees.

const PAGE_LIMIT = 200;

/**
 * Sessions that lack a full check-in, with the missing side (D-070), plus the ones a PT asked the admin to confirm
 * (D-071). A PT with own-schedule scope sees only their own sessions.
 */
export async function listHanging(actor: Actor, now: Date = new Date()): Promise<{ items: HangingSession[] }> {
  assertCan(actor, "booking.view");
  const waitMinutes = Number((await readParameters()).scanPairWaitMinutes);
  const where: Prisma.BookingWhereInput = {
    AND: [
      bookingsVisibleTo(actor),
      { status: "BOOKED" },
      {
        OR: [
          { customerScanId: { not: null }, ptScanId: null },
          { customerScanId: null, ptScanId: { not: null } },
          { scanRequestedAt: { not: null } },
        ],
      },
    ],
  };
  const { items } = await bookingRepo.listBookings(prisma, where, { order: "asc", skip: 0, take: PAGE_LIMIT });
  const scanIds = items.flatMap((b) => [b.customerScanId, b.ptScanId]).filter((id): id is string => id !== null);
  const scans = new Map(
    (await prisma.checkinScan.findMany({ where: { id: { in: scanIds } }, select: { id: true, scannedAt: true } })).map(
      (scan) => [scan.id, scan.scannedAt],
    ),
  );
  const rows: HangingSession[] = [];
  for (const booking of items) {
    const customerScanAt = booking.customerScanId ? (scans.get(booking.customerScanId) ?? null) : null;
    const ptScanAt = booking.ptScanId ? (scans.get(booking.ptScanId) ?? null) : null;
    const reason = hangingReason({ customerScanAt, ptScanAt }, now, waitMinutes);
    const requested = booking.scanRequestedAt !== null;
    // Waiting for the other side still, and nobody asked: not hanging yet.
    if (!reason && !requested) continue;
    rows.push({
      booking: toBookingView(booking),
      reason,
      firstScanAt: customerScanAt ?? ptScanAt,
      requested,
    });
  }
  return { items: rows };
}

/**
 * D-071: the PT says the customer trained but did not scan. It asks the admin to confirm Đã tập; nothing changes for
 * the customer until the admin does. Repeating it keeps the first request.
 */
export async function requestManualConfirmation(actor: Actor, bookingId: string): Promise<void> {
  assertCan(actor, "booking.manage");
  await changeLockedBooking(actor, bookingId, async (tx, booking) => {
    if (booking.status !== "BOOKED") throw new AppError("INVALID_STATUS_TRANSITION");
    if (booking.scanRequestedAt) return;
    await tx.booking.update({
      where: { id: booking.id },
      data: { scanRequestedAt: new Date(), scanRequestedById: actor.id },
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "booking",
      entityId: booking.id,
      action: "booking.scan_requested",
      context: { contractId: booking.contractId },
    });
  });
}

/** The scans received, newest first; the error list is the same list filtered to ERROR (D-070). */
export async function listScans(actor: Actor, rawQuery: unknown): Promise<CheckinScanPage> {
  assertCan(actor, "checkin.review");
  const { result, page, pageSize } = parseInput(listScansSchema, rawQuery);
  const where: Prisma.CheckinScanWhereInput = { ...inBranches(actor), ...(result ? { result } : {}) };
  const [rows, total] = await Promise.all([
    prisma.checkinScan.findMany({
      where,
      orderBy: [{ scannedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        device: { select: { name: true } },
        // The subject's name, whichever kind it is.
      },
    }),
    prisma.checkinScan.count({ where }),
  ]);
  const customers = await prisma.customer.findMany({
    where: { id: { in: rows.map((r) => r.customerId).filter((id): id is string => id !== null) } },
    select: { id: true, fullName: true },
  });
  const employees = await prisma.employee.findMany({
    where: { id: { in: rows.map((r) => r.employeeId).filter((id): id is string => id !== null) } },
    select: { id: true, fullName: true },
  });
  const names = new Map([...customers, ...employees].map((person) => [person.id, person.fullName]));
  return {
    items: rows.map((row) => {
      const id = row.customerId ?? row.employeeId;
      return {
        id: row.id,
        scannedAt: row.scannedAt,
        receivedAt: row.receivedAt,
        device: row.device.name,
        userCode: row.machineUserCode,
        subject:
          id && row.subjectType
            ? { type: row.subjectType as "CUSTOMER" | "EMPLOYEE", id, name: names.get(id) ?? "" }
            : null,
        result: row.result as "WAITING" | "PAIRED" | "ERROR" | "REPEAT",
        errorCode: row.errorCode,
        bookingId: row.bookingId,
      };
    }),
    total,
    page,
    pageSize,
  };
}

/** D-071: the sessions confirmed by hand, per PT and per customer, over a period of gym days. */
export async function manualConfirmationReport(actor: Actor, rawQuery: unknown): Promise<ManualReport> {
  assertCan(actor, "report.manualConfirmations");
  const { from, to } = parseInput(manualReportQuerySchema, rawQuery);
  const where: Prisma.BookingWhereInput = {
    ...inBranches(actor),
    status: "TRAINED",
    session: { is: { confirmationMethod: "MANUAL", completedAt: gymDaysRange(from, to) } },
  };
  const [perTrainer, perCustomer] = await Promise.all([
    prisma.booking.groupBy({ by: ["trainerId"], where, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ["customerId"], where, _count: { _all: true } }),
  ]);
  const trainers = await prisma.employee.findMany({
    where: { id: { in: perTrainer.map((row) => row.trainerId) } },
    select: { id: true, fullName: true },
  });
  const customers = await prisma.customer.findMany({
    where: { id: { in: perCustomer.map((row) => row.customerId) } },
    select: { id: true, fullName: true },
  });
  const rows = <K extends string>(
    groups: ({ _count: { _all: number } } & Record<K, string>)[],
    people: { id: string; fullName: string }[],
    key: K,
  ) =>
    groups
      .map((group) => ({
        id: group[key],
        name: people.find((person) => person.id === group[key])?.fullName ?? "",
        sessions: group._count._all,
      }))
      .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
  return {
    total: perTrainer.reduce((sum, row) => sum + row._count._all, 0),
    perTrainer: rows(perTrainer, trainers, "trainerId"),
    perCustomer: rows(perCustomer, customers, "customerId"),
  };
}

// ---------------------------------------------------------------- machine user codes (D-072)

export async function getMachineCode(
  actor: Actor,
  subject: MachineSubject,
  id: string,
): Promise<{ code: string | null }> {
  assertCan(actor, "checkin.devices");
  const row = await findSubject(subject, id, actor);
  return { code: row.machineUserCode };
}

/** Sets or clears the code the machine knows a person by. One code belongs to one person across customers and staff. */
export async function setMachineCode(
  actor: Actor,
  subject: MachineSubject,
  id: string,
  rawInput: unknown,
): Promise<{ code: string | null }> {
  assertCan(actor, "checkin.devices");
  const { code } = parseInput(machineCodeSchema, rawInput);
  const next = code === "" ? null : code;
  return prisma.$transaction(async (tx) => {
    const before = await findSubject(subject, id, actor, tx);
    if (next !== null) {
      const [customer, employee] = await Promise.all([
        tx.customer.findFirst({ where: { machineUserCode: next, NOT: { id } }, select: { id: true } }),
        tx.employee.findFirst({ where: { machineUserCode: next, NOT: { id } }, select: { id: true } }),
      ]);
      if (customer || employee) {
        throw new AppError("VALIDATION_FAILED", { fieldErrors: { code: ["machineCodeTaken"] } });
      }
    }
    if (before.machineUserCode !== next) {
      await (subject === "customer"
        ? tx.customer.update({ where: { id }, data: { machineUserCode: next }, select: { id: true } })
        : tx.employee.update({ where: { id }, data: { machineUserCode: next }, select: { id: true } }));
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: subject,
        entityId: id,
        action: `${subject}.machine_code_changed`,
        before: { machineUserCode: before.machineUserCode },
        after: { machineUserCode: next },
      });
    }
    return { code: next };
  });
}

async function findSubject(
  subject: MachineSubject,
  id: string,
  actor: Actor,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ machineUserCode: string | null }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND");
  const where = { id, ...inBranches(actor) };
  const select = { machineUserCode: true };
  const row =
    subject === "customer"
      ? await db.customer.findFirst({ where, select })
      : await db.employee.findFirst({ where, select });
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

// ---------------------------------------------------------------- escalation (D-071)

/**
 * A session that still hangs after the escalation hours is reported to the people who review check-ins in its branch,
 * once, with a task for the Studio Manager's department. 0 hours switches it off.
 */
export async function escalateHangingSessions(now: Date = new Date()): Promise<number> {
  const parameters = await readParameters();
  const hours = Number(parameters.hangingEscalationHours);
  if (hours <= 0) return 0;
  const cutoff = new Date(now.getTime() - hours * 3_600_000);
  return prisma.$transaction(async (tx) => {
    const due = await tx.booking.findMany({
      where: {
        status: "BOOKED",
        hangingEscalatedAt: null,
        scheduledEnd: { lt: cutoff },
        OR: [
          { customerScanId: { not: null }, ptScanId: null },
          { customerScanId: null, ptScanId: { not: null } },
        ],
      },
      select: {
        id: true,
        branchId: true,
        customerId: true,
        scheduledStart: true,
        customer: { select: { fullName: true } },
        trainer: { select: { fullName: true } },
      },
      take: 100,
    });
    for (const booking of due) {
      await tx.booking.update({ where: { id: booking.id }, data: { hangingEscalatedAt: now } });
      const reviewers = await tx.user.findMany({
        where: {
          status: "ACTIVE",
          OR: [{ allBranches: true }, { branches: { some: { branchId: booking.branchId } } }],
          role: { permissions: { some: { permission: "checkin.review" } } },
        },
        select: { id: true },
      });
      await notify(
        tx,
        reviewers.map((user) => user.id),
        {
          kind: "sessionHanging",
          params: { customer: booking.customer.fullName, trainer: booking.trainer.fullName, hours: String(hours) },
          link: "/checkin?view=hanging",
        },
      );
      if (reviewers[0]) {
        await createHangingSessionTask(tx, {
          booking: { id: booking.id, branchId: booking.branchId },
          customerId: booking.customerId,
          customerName: booking.customer.fullName,
          trainerName: booking.trainer.fullName,
          by: reviewers[0].id,
          hours,
          dueAt: now,
        });
      }
    }
    return due.length;
  });
}
