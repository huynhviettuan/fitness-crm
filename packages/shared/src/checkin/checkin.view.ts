import { z } from "zod";
import { bookingSchema } from "../bookings/booking.view.js";
import { instant, listOf, pageOf } from "../validation/index.js";
import { SCAN_RESULTS } from "./checkin.domain.js";

export const deviceSchema = z
  .object({
    id: z.uuid(),
    branch: z.object({ id: z.uuid(), name: z.string() }),
    name: z.string(),
    active: z.boolean(),
    lastSeenAt: instant.nullable(),
    /** The machine's clock minus the server's at its last report, in seconds. */
    clockOffsetSeconds: z.int().nullable(),
    /** The clock is off by more than the tolerance (D-072). */
    clockOff: z.boolean(),
  })
  .meta({ id: "CheckinDevice" });

export const deviceListSchema = listOf(deviceSchema).meta({ id: "CheckinDeviceList" });

/** Shown once, when the machine is registered or its key is replaced; only a hash is kept. */
export const deviceCreatedSchema = z
  .object({ device: deviceSchema, key: z.string() })
  .meta({ id: "CheckinDeviceCreated" });

/** The answer for one scan received. */
export const scanAnswerSchema = z
  .object({
    userCode: z.string(),
    scannedAt: instant,
    result: z.enum(SCAN_RESULTS),
    errorCode: z.string().nullable(),
    bookingId: z.uuid().nullable(),
  })
  .meta({ id: "CheckinScanAnswer" });

/**
 * What a machine's key belongs to (M5.8b, A-310): the machine and its branch, and the server's time, so whoever sets up the bridge
 * sees at once that the key is right and how far the computer's clock is off. Nothing else about the gym.
 */
export const deviceIdentitySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    branch: z.object({ id: z.uuid(), name: z.string() }),
    serverTime: z.iso.datetime(),
  })
  .meta({ id: "CheckinDeviceIdentity" });
export type CheckinDeviceIdentity = z.output<typeof deviceIdentitySchema>;

export const scansAnswerSchema = z
  .object({ items: z.array(scanAnswerSchema), clockOff: z.boolean() })
  .meta({ id: "CheckinScansAnswer" });

export const scanSchema = z
  .object({
    id: z.uuid(),
    scannedAt: instant,
    receivedAt: instant,
    device: z.string(),
    userCode: z.string(),
    subject: z.object({ type: z.enum(["CUSTOMER", "EMPLOYEE"]), id: z.uuid(), name: z.string() }).nullable(),
    result: z.enum(SCAN_RESULTS),
    errorCode: z.string().nullable(),
    bookingId: z.uuid().nullable(),
  })
  .meta({ id: "CheckinScan" });

export const scanPageSchema = pageOf(scanSchema).meta({ id: "CheckinScanPage" });

/** A session that lacks a pair, and why (D-070, D-071). */
export const hangingSchema = z
  .object({
    booking: bookingSchema,
    /** Which side is missing; null when nobody scanned and the PT asked for a manual confirmation. */
    reason: z.enum(["PT_MISSING", "CUSTOMER_MISSING"]).nullable(),
    firstScanAt: instant.nullable(),
    /** The PT said the customer trained but did not scan: waiting for the admin. */
    requested: z.boolean(),
  })
  .meta({ id: "HangingSession" });

export const hangingListSchema = listOf(hangingSchema).meta({ id: "HangingSessionList" });

export const machineCodeViewSchema = z.object({ code: z.string().nullable() }).meta({ id: "MachineCode" });

/** Sessions the admin confirmed by hand, per PT and per customer (D-071). */
export const manualReportSchema = z
  .object({
    total: z.int(),
    perTrainer: z.array(z.object({ id: z.uuid(), name: z.string(), sessions: z.int() })),
    perCustomer: z.array(z.object({ id: z.uuid(), name: z.string(), sessions: z.int() })),
  })
  .meta({ id: "ManualConfirmationReport" });

export type CheckinDevice = z.output<typeof deviceSchema>;
export type CheckinScan = z.output<typeof scanSchema>;
export type CheckinScanPage = z.output<typeof scanPageSchema>;
export type HangingSession = z.output<typeof hangingSchema>;
export type ManualReport = z.output<typeof manualReportSchema>;
