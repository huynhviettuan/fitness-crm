import { z } from "zod";
import { optionChoice, optionNote } from "../options/option.schema.js";
import { paymentInputSchema } from "../finance/finance.schema.js";
import {
  hasNoControlCharacters,
  optionalCalendarDate,
  percentNumber,
  vndAmount,
  wholeNumber,
} from "../validation/index.js";
import { CONTRACT_TYPES } from "./contract.domain.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
// Forms send "" for an empty optional field; it is stored as null.

const optionalUuid = z
  .union([z.literal(""), z.null(), z.uuid({ error: "invalidChoice" })])
  .transform((value) => (value === "" ? null : value));

const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });
const optionalText = (max: number) => text(max).transform((value) => (value === "" ? null : value));
/** One line: no line break in a name that is printed. */
const oneLine = (max: number) =>
  optionalText(max).refine((value) => value === null || /^[^\r\n\t]*$/.test(value), { error: "invalidCharacters" });

/** One staff member's share of a contract, in percent (A-115). */
export const shareInputSchema = z.object({
  employeeId: z.uuid({ error: "invalidChoice" }),
  percent: percentNumber(0.01, 100),
});

/**
 * The first payment taken with the contract (A-119): a pending receipt like any other. The day is the contract's.
 */
export const firstPaymentInputSchema = paymentInputSchema.omit({ paidOn: true });

/**
 * The fields staff enter (FR-CON-001). The unit price, total, end date, name, code, status, and approval are never
 * accepted from the client (BR-301, BR-001): the API computes them from the service's tier. A price different from
 * the tier is an exception price with a reason (BR-302, A-113).
 */
export const contractInputSchema = z
  .object({
    serviceId: z.uuid({ error: "invalidChoice" }),
    sessions: wholeNumber(1, 1000),
    contractType: z.enum(CONTRACT_TYPES, { error: "invalidChoice" }).prefault("NEW"),
    /** The contract a renewal follows (brief §5.2). */
    previousContractId: optionalUuid.prefault(""),
    /** The day prices apply; today when empty. */
    contractDate: optionalCalendarDate.prefault(""),
    /** The first day of use; the contract date when empty. */
    startDate: optionalCalendarDate.prefault(""),
    activationDeadline: optionalCalendarDate.prefault(""),
    bonusSessions: wholeNumber(0, 1000).prefault(0),
    bonusMonths: wholeNumber(0, 60).prefault(0),
    bonusDays: wholeNumber(0, 365).prefault(0),
    promotionId: optionalUuid.prefault(""),
    voucherCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(40, { error: "tooLong" })
      .refine(hasNoControlCharacters, { error: "invalidCharacters" })
      .transform((value) => (value === "" ? null : value))
      .prefault(""),
    vatPercent: percentNumber().prefault(0),
    /** An agreed price per session that differs from the tier (BR-302). */
    proposedUnitPrice: z
      .union([z.literal(""), z.null(), vndAmount])
      .transform((value) => (value === "" ? null : value))
      .prefault(""),
    exceptionReasonId: optionChoice
      .or(z.literal(""))
      .or(z.null())
      .transform((value) => (value === "" ? null : value))
      .prefault(""),
    exceptionNote: optionNote.prefault(""),
    ptShares: z.array(shareInputSchema).max(20, { error: "tooLong" }).prefault([]),
    saleShares: z.array(shareInputSchema).max(20, { error: "tooLong" }).prefault([]),
    /** Other members of a group package (A-116). */
    companionIds: z
      .array(z.uuid({ error: "invalidChoice" }))
      .max(50, { error: "tooLong" })
      .prefault([]),
    signed: z.boolean({ error: "invalidChoice" }).prefault(false),
    signedOn: optionalCalendarDate.prefault(""),
    signedBy: oneLine(100).prefault(""),
    signatureNote: optionalText(500).prefault(""),
    firstPayment: firstPaymentInputSchema.nullable().prefault(null),
    /** When the rest is due. */
    paymentDueOn: optionalCalendarDate.prefault(""),
    notes: optionalText(2000).prefault(""),
  })
  .superRefine((data, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (data.contractType === "NEW" && data.previousContractId) fail("previousContractId", "newHasNoPrevious");
    if (data.proposedUnitPrice !== null && !data.exceptionReasonId) fail("exceptionReasonId", "required");
    if (data.proposedUnitPrice === null && data.exceptionReasonId) fail("proposedUnitPrice", "required");
    if (data.proposedUnitPrice !== null && (data.promotionId || data.voucherCode)) {
      fail("proposedUnitPrice", "exceptionExcludesPromotion");
    }
    if (data.signed && !data.signedOn) fail("signedOn", "required");
    if (data.startDate && data.activationDeadline && data.activationDeadline.getTime() < data.startDate.getTime()) {
      fail("activationDeadline", "deadlineBeforeStart");
    }
    for (const key of ["ptShares", "saleShares"] as const) {
      if (new Set(data[key].map((share) => share.employeeId)).size !== data[key].length) fail(key, "duplicateEmployee");
    }
    if (new Set(data.companionIds).size !== data.companionIds.length) fail("companionIds", "duplicateCompanion");
  });

export const contractStaffQuerySchema = z.object({ branchId: z.uuid().optional() });

/** T-015: a client-generated UUID sent with every create. */
export const idempotencyKeySchema = z.uuid();

/** Sending an approved contract back to pending approval needs a reason from `unapproveReasons` (A-124). */
export const unapproveSchema = z.object({ reasonId: optionChoice, reasonNote: optionNote });

export const listContractsSchema = z.object({
  q: z.string().trim().max(100).refine(hasNoControlCharacters).optional().default(""),
  customerId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ContractInput = z.input<typeof contractInputSchema>;
export type ContractData = z.output<typeof contractInputSchema>;
export type UnapproveInput = z.input<typeof unapproveSchema>;
