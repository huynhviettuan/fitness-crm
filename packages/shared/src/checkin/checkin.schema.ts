import { z } from "zod";
import { calendarDate, hasNoControlCharacters } from "../validation/index.js";

const userCode = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .max(40, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" });

/** What a machine sends: the scans it holds, each with the real time of the scan (D-072). */
export const scansInputSchema = z.object({
  /** The machine's own clock when it sent, to measure how far off it is. */
  sentAt: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .optional(),
  scans: z
    .array(
      z.object({
        userCode,
        scannedAt: z.iso.datetime().transform((value) => new Date(value)),
      }),
    )
    .min(1, { error: "required" })
    .max(500),
});

export const deviceInputSchema = z.object({
  branchId: z.uuid({ error: "required" }),
  name: z
    .string()
    .trim()
    .min(1, { error: "required" })
    .max(100, { error: "tooLong" })
    .refine(hasNoControlCharacters, { error: "invalidCharacters" }),
});

export const deviceUpdateSchema = z.object({
  name: deviceInputSchema.shape.name,
  active: z.boolean(),
});

/** The machine user code of a customer or an employee; empty clears it (D-072). */
export const machineCodeSchema = z.object({
  code: z.string().trim().max(40, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" }),
});

export const MACHINE_SUBJECTS = ["customer", "employee"] as const;
export type MachineSubject = (typeof MACHINE_SUBJECTS)[number];

export const listScansSchema = z.object({
  result: z.enum(["WAITING", "PAIRED", "ERROR", "REPEAT"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/** First and last gym day of the report of sessions confirmed by hand, dd/MM/yyyy. */
const optionalDate = z
  .union([z.literal(""), calendarDate])
  .optional()
  .transform((value) => value || undefined);
export const manualReportQuerySchema = z.object({ from: optionalDate, to: optionalDate });

export type ScansInput = z.input<typeof scansInputSchema>;
export type DeviceInput = z.input<typeof deviceInputSchema>;
