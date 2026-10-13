import { z } from "zod";
import { instant } from "../validation/index.js";

// The contract report and the exception-price report (brief §9, D-041; A-139 to A-141).

const person = z.object({ id: z.uuid(), name: z.string() });

/** One service and session-tier band of the contract report. Contracts brought over from before the tiers have none. */
export const contractReportRowSchema = z.object({
  service: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** The tier's session range; `max` is empty when the tier has no upper limit. */
  band: z.object({ min: z.int(), max: z.int().nullable() }).nullable(),
  /** Approved first contracts and renewals dated in the period. */
  newContracts: z.int(),
  renewedContracts: z.int(),
  /** The value of those contracts. */
  value: z.int(),
  /** Valid receipts received in the period on contracts of this group (D-011: no opening balances). */
  revenue: z.int(),
  /** What those contracts still owe now. */
  debt: z.int(),
  /** Running contracts of this group that end within `expiringSoonDays`, as of today. */
  expiringSoon: z.int(),
  /** Running contracts of this group with `runningOutSessions` sessions left or fewer, as of today. */
  runningOut: z.int(),
});

export const contractReportSchema = z
  .object({
    from: instant,
    to: instant,
    rows: z.array(contractReportRowSchema),
    totals: contractReportRowSchema.omit({ service: true, band: true }),
  })
  .meta({ id: "ContractReport" });

/** The contracts of one person (creator or approver) and how many of them carry an exception price (BR-302). */
export const exceptionPriceRowSchema = z.object({
  user: person,
  contracts: z.int(),
  exceptions: z.int(),
  /** Exception ÷ contracts, in percent. */
  share: z.int(),
  /** The tier price less the approved price, times the sessions, over the exception contracts. */
  difference: z.int(),
});

export const exceptionPriceReportSchema = z
  .object({
    from: instant,
    to: instant,
    byCreator: z.array(exceptionPriceRowSchema),
    byApprover: z.array(exceptionPriceRowSchema),
    totals: z.object({ contracts: z.int(), exceptions: z.int(), share: z.int(), difference: z.int() }),
  })
  .meta({ id: "ExceptionPriceReport" });

export type ContractReport = z.output<typeof contractReportSchema>;
export type ContractReportRow = z.output<typeof contractReportRowSchema>;
export type ExceptionPriceReport = z.output<typeof exceptionPriceReportSchema>;
export type ExceptionPriceRow = z.output<typeof exceptionPriceRowSchema>;

/** The share of `part` in `whole`, in whole percent (0 when there is nothing). */
export function percentOf(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** The label of a tier band: "10–19", or "50+" for a tier without an upper limit. */
export function bandLabel(band: { min: number; max: number | null }): string {
  return band.max === null ? `${band.min}+` : `${band.min}–${band.max}`;
}
