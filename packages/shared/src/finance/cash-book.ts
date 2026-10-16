import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { calendarDate, instant, vndAmount } from "../validation/index.js";

// The cash book and the income and expense report (brief §8.1, §9, FR-CASH-005, AC-19; A-138, A-139).

/** Forms send "" for a filter left empty. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** The period (dd/MM/yyyy, inclusive; this month when empty) and branch every money report is about. */
export const periodReportQuerySchema = z.object({
  from: optional(calendarDate),
  to: optional(calendarDate),
  branchId: optional(z.uuid({ error: "invalidChoice" })),
});

export type PeriodReportQuery = z.input<typeof periodReportQuerySchema>;

const figures = {
  opening: z.int(),
  inflow: z.int(),
  outflow: z.int(),
  closing: z.int(),
};

/** The cash book of one branch and payment method over the period (A-138). */
export const cashBookRowSchema = z.object({ branch: branchRefSchema, method: chosenOptionSchema, ...figures });

/** The cash book of one day, over every branch and method in the report. */
export const cashBookDaySchema = z.object({ day: instant, ...figures });

export const cashBookSchema = z
  .object({
    from: instant,
    to: instant,
    rows: z.array(cashBookRowSchema),
    days: z.array(cashBookDaySchema),
    totals: z.object(figures),
  })
  .meta({ id: "CashBook" });

/** The cash a branch held in a payment method when its books begin (A-138). */
export const cashOpeningSchema = z
  .object({
    branch: branchRefSchema,
    method: chosenOptionSchema,
    effectiveOn: instant,
    amount: z.int(),
  })
  .meta({ id: "CashOpening" });

export const cashOpeningListSchema = z.object({ items: z.array(cashOpeningSchema) }).meta({ id: "CashOpeningList" });

export const cashOpeningInputSchema = z.object({
  branchId: z.uuid({ error: "invalidChoice" }),
  methodId: z.uuid({ error: "invalidChoice" }),
  effectiveOn: calendarDate,
  /** Zero is allowed: a branch may start with an empty till. */
  amount: vndAmount,
});

/** Where a line of the income and expense report comes from. */
export const MONEY_LINE_KINDS = ["CONTRACT_PAYMENT", "INCOME", "EXPENSE"] as const;
export type MoneyLineKind = (typeof MONEY_LINE_KINDS)[number];

export const moneyLineSchema = z.object({
  kind: z.enum(MONEY_LINE_KINDS),
  /** The category of an income or an expense; none for contract payments. */
  category: chosenOptionSchema.nullable(),
  count: z.int(),
  amount: z.int(),
});

export const incomeExpenseSchema = z
  .object({
    from: instant,
    to: instant,
    lines: z.array(moneyLineSchema),
    income: z.int(),
    expense: z.int(),
    net: z.int(),
  })
  .meta({ id: "IncomeExpense" });

export type CashBook = z.output<typeof cashBookSchema>;
export type CashBookRow = z.output<typeof cashBookRowSchema>;
export type CashBookDay = z.output<typeof cashBookDaySchema>;
export type CashOpening = z.output<typeof cashOpeningSchema>;
export type CashOpeningInput = z.input<typeof cashOpeningInputSchema>;
export type IncomeExpense = z.output<typeof incomeExpenseSchema>;
export type MoneyLine = z.output<typeof moneyLineSchema>;

export type CashFigures = { opening: number; inflow: number; outflow: number; closing: number };

/** AC-19: the closing balance is the opening balance plus what came in less what went out. */
export function closingBalance(opening: number, inflow: number, outflow: number): number {
  return opening + inflow - outflow;
}

/**
 * The cash book day by day (A-138): each day opens with the closing of the day before, so the days chain and the last
 * closing equals the period's. `moved` is keyed by the day as yyyy-MM-dd; a day without movements is still listed.
 */
export function cashBookDays(
  opening: number,
  from: Date,
  to: Date,
  moved: ReadonlyMap<string, { inflow: number; outflow: number }>,
): { day: Date; opening: number; inflow: number; outflow: number; closing: number }[] {
  const days = [];
  let running = opening;
  for (let at = from.getTime(); at <= to.getTime(); at += 86_400_000) {
    const day = new Date(at);
    const { inflow, outflow } = moved.get(day.toISOString().slice(0, 10)) ?? { inflow: 0, outflow: 0 };
    const closing = closingBalance(running, inflow, outflow);
    days.push({ day, opening: running, inflow, outflow, closing });
    running = closing;
  }
  return days;
}

/** The number of days a report period may span, so a typo cannot ask for centuries. */
export const MAX_REPORT_DAYS = 3660;
