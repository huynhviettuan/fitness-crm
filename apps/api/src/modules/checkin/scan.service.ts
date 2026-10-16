import {
  isClockOff,
  isPairedInTime,
  pickCandidate,
  scansInputSchema,
  type PairCandidate,
  type PairingRules,
  type ScanResult,
} from "@gymcrm/shared/checkin";
import type { Prisma } from "../../generated/prisma/client.js";
import { LOCKING_TRANSACTION, prisma } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { readParameters } from "../../platform/parameters/parameter.service.js";
import { parseInput } from "../../platform/validation/parse.js";
import * as bookingRepo from "../bookings/booking.repository.js";
import { confirmBooking, sessionProblem } from "../sessions/session.service.js";
import type { AuthenticatedDevice } from "./device.service.js";

// Receiving scans from a machine and pairing them with booked sessions (M5.3b, brief §6.6, D-069 to D-072). Every scan
// is stored raw with its result. A pair (the customer's scan and the booked PT's scan, within the waiting time of each
// other and inside the window around the session) confirms the session through the one event of D-069.

export type ScanAnswer = {
  userCode: string;
  scannedAt: Date;
  result: ScanResult;
  errorCode: string | null;
  bookingId: string | null;
};

type Subject = { type: "CUSTOMER"; id: string } | { type: "EMPLOYEE"; id: string };

/** Pairing attempts per scan when another scan takes the chosen session first. */
const ATTEMPTS = 3;

export async function receiveScans(
  device: AuthenticatedDevice,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<{ items: ScanAnswer[]; clockOff: boolean }> {
  const input = parseInput(scansInputSchema, rawInput);
  const parameters = await readParameters();
  const rules: PairingRules = {
    waitMinutes: Number(parameters.scanPairWaitMinutes),
    windowMinutes: Number(parameters.scanWindowMinutes),
  };
  const repeatSeconds = Number(parameters.scanRepeatSeconds);

  // D-072: the machine's clock against ours, from the time it says it sent the batch.
  const offset = input.sentAt ? Math.round((input.sentAt.getTime() - now.getTime()) / 1000) : null;
  await prisma.checkinDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: now, ...(offset === null ? {} : { clockOffsetSeconds: offset }) },
  });

  // Offline scans arrive late and in any order; pairing uses the real scan time, so oldest first.
  const ordered = [...input.scans].sort((a, b) => a.scannedAt.getTime() - b.scannedAt.getTime());
  const items: ScanAnswer[] = [];
  for (const scan of ordered) {
    items.push(await processScan(device, scan.userCode, scan.scannedAt, rules, repeatSeconds));
  }
  return { items, clockOff: isClockOff(offset, Number(parameters.scanClockToleranceSeconds)) };
}

async function processScan(
  device: AuthenticatedDevice,
  userCode: string,
  scannedAt: Date,
  rules: PairingRules,
  repeatSeconds: number,
): Promise<ScanAnswer> {
  const answer = (result: ScanResult, errorCode: string | null, bookingId: string | null): ScanAnswer => ({
    userCode,
    scannedAt,
    result,
    errorCode,
    bookingId,
  });

  // A machine that resends a batch gets the stored answer, not a second scan.
  const known = await prisma.checkinScan.findUnique({
    where: { deviceId_machineUserCode_scannedAt: { deviceId: device.id, machineUserCode: userCode, scannedAt } },
  });
  if (known) return answer(known.result as ScanResult, known.errorCode, known.bookingId);

  const subject = await findSubject(userCode);
  const base = {
    deviceId: device.id,
    branchId: device.branchId,
    machineUserCode: userCode,
    scannedAt,
    subjectType: subject?.type ?? null,
    customerId: subject?.type === "CUSTOMER" ? subject.id : null,
    employeeId: subject?.type === "EMPLOYEE" ? subject.id : null,
  };
  const store = async (result: ScanResult, errorCode: string | null, bookingId: string | null = null) => {
    await prisma.checkinScan.create({ data: { ...base, result, errorCode, bookingId } });
    return answer(result, errorCode, bookingId);
  };

  if (!subject) return store("ERROR", "UNKNOWN_USER");
  // D-070: a repeat scan within a few seconds counts once.
  const since = new Date(scannedAt.getTime() - repeatSeconds * 1000);
  const repeat = await prisma.checkinScan.findFirst({
    where: {
      machineUserCode: userCode,
      result: { not: "REPEAT" },
      scannedAt: { gte: since, lte: scannedAt },
    },
    select: { id: true },
  });
  if (repeat) return store("REPEAT", null);

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const outcome = await prisma.$transaction(
        (tx) => pair(tx, device, subject, scannedAt, rules, base),
        LOCKING_TRANSACTION,
      );
      if (outcome) return answer(outcome.result, outcome.errorCode, outcome.bookingId);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      // The pairing itself was refused (the contract cannot give a session): the scan is an error (D-070).
      return store("ERROR", error.code);
    }
  }
  return store("ERROR", "NO_BOOKING");
}

async function findSubject(userCode: string): Promise<Subject | null> {
  const [customer, employee] = await Promise.all([
    prisma.customer.findUnique({ where: { machineUserCode: userCode }, select: { id: true } }),
    prisma.employee.findUnique({ where: { machineUserCode: userCode }, select: { id: true } }),
  ]);
  if (customer) return { type: "CUSTOMER", id: customer.id };
  if (employee) return { type: "EMPLOYEE", id: employee.id };
  return null;
}

type ScanBase = {
  deviceId: string;
  branchId: string;
  machineUserCode: string;
  scannedAt: Date;
  subjectType: string | null;
  customerId: string | null;
  employeeId: string | null;
};

type Outcome = { result: ScanResult; errorCode: string | null; bookingId: string | null };

/**
 * One pairing attempt in a transaction. Returns null when the chosen session was taken by another scan between the
 * choice and the lock, so the caller chooses again; throws the contract's error when the session cannot be taken off.
 */
async function pair(
  tx: Prisma.TransactionClient,
  device: AuthenticatedDevice,
  subject: Subject,
  scannedAt: Date,
  rules: PairingRules,
  base: ScanBase,
): Promise<Outcome | null> {
  const isCustomer = subject.type === "CUSTOMER";
  const windowMs = rules.windowMinutes * 60_000;
  const open = await tx.booking.findMany({
    where: {
      branchId: device.branchId,
      status: "BOOKED",
      ...(isCustomer ? { customerId: subject.id, customerScanId: null } : { trainerId: subject.id, ptScanId: null }),
      scheduledStart: { lte: new Date(scannedAt.getTime() + windowMs) },
      scheduledEnd: { gte: new Date(scannedAt.getTime() - windowMs) },
    },
    select: {
      id: true,
      scheduledStart: true,
      scheduledEnd: true,
      customerScan: { select: { scannedAt: true } },
      ptScan: { select: { scannedAt: true } },
    },
  });
  const candidates: PairCandidate[] = open.map((booking) => ({
    id: booking.id,
    start: booking.scheduledStart,
    end: booking.scheduledEnd,
    otherScanAt: (isCustomer ? booking.ptScan : booking.customerScan)?.scannedAt ?? null,
  }));
  // A session whose other side scanned too long ago can no longer be paired by this scan (D-070).
  const usable = candidates.filter(
    (candidate) =>
      candidate.otherScanAt === null || isPairedInTime(candidate.otherScanAt, scannedAt, rules.waitMinutes),
  );
  const picked = pickCandidate(usable, scannedAt, rules);
  if (!picked) {
    const tooLate = pickCandidate(candidates, scannedAt, rules);
    await tx.checkinScan.create({
      data: { ...base, result: "ERROR", errorCode: tooLate ? "PAIR_TOO_LATE" : "NO_BOOKING", bookingId: tooLate?.id },
    });
    return { result: "ERROR", errorCode: tooLate ? "PAIR_TOO_LATE" : "NO_BOOKING", bookingId: tooLate?.id ?? null };
  }

  // Lock order: the contract, then the booking (T-013); then look again, because another scan may have won.
  if (!(await bookingRepo.lockBooking(tx, picked.id))) return null;
  const booking = await bookingRepo.findBooking(tx, picked.id, {});
  const sideTaken = isCustomer ? booking?.customerScanId : booking?.ptScanId;
  if (!booking || booking.status !== "BOOKED" || sideTaken) return null;

  // D-070: a scan on a contract with no sessions left, expired, or on hold is an error.
  const problem = await sessionProblem(tx, booking);
  if (problem.code) throw new AppError(problem.code);

  // The other side, as it stands now that the booking is locked.
  const otherScanId = isCustomer ? booking.ptScanId : booking.customerScanId;
  const other = otherScanId
    ? await tx.checkinScan.findUnique({ where: { id: otherScanId }, select: { scannedAt: true } })
    : null;
  if (other && !isPairedInTime(other.scannedAt, scannedAt, rules.waitMinutes)) {
    await tx.checkinScan.create({
      data: { ...base, result: "ERROR", errorCode: "PAIR_TOO_LATE", bookingId: booking.id },
    });
    return { result: "ERROR", errorCode: "PAIR_TOO_LATE", bookingId: booking.id };
  }

  const scan = await tx.checkinScan.create({ data: { ...base, result: "WAITING", bookingId: booking.id } });
  const side = isCustomer ? { customerScanId: scan.id } : { ptScanId: scan.id };
  await tx.booking.update({ where: { id: booking.id }, data: side });
  if (!other || !otherScanId) return { result: "WAITING", errorCode: null, bookingId: booking.id };

  // Both sides are in: the one event "session confirmed" (D-069).
  await confirmBooking(tx, booking, {
    method: "DEVICE",
    actorId: null,
    context: isCustomer
      ? { customerScanId: scan.id, ptScanId: otherScanId }
      : { customerScanId: otherScanId, ptScanId: scan.id },
  });
  await tx.checkinScan.updateMany({ where: { id: { in: [scan.id, otherScanId] } }, data: { result: "PAIRED" } });
  return { result: "PAIRED", errorCode: null, bookingId: booking.id };
}
