import { z } from "zod";
import { instant } from "../validation/index.js";

// The overview dashboard (brief §9, docs/10; A-172): the first version, over a period and a branch.

export const overviewSchema = z
  .object({
    from: instant,
    to: instant,
    /** Leads created in the period. */
    newLeads: z.int(),
    /** Of those, the ones that now have an approved contract. */
    convertedLeads: z.int(),
    /** Converted ÷ new leads, in percent. */
    conversionRate: z.int(),
    /** Customers with a session used (PT or class) in the period. */
    membersTraining: z.int(),
    /** Active employees who teach PT. */
    activePts: z.int(),
    /** Running contracts that end within `expiringSoonDays` or have `runningOutSessions` sessions left or fewer. */
    endingSoon: z.int(),
    expiringSoonDays: z.int(),
    runningOutSessions: z.int(),
    /** PT sessions that credited a PT in the period, by the hour of the gym's day they started. */
    sessionsByHour: z.array(z.object({ hour: z.int(), sessions: z.int() })),
    /** Valid receipts by month, the 12 months up to the end of the period; null when the role has receipts hidden. */
    revenueByMonth: z.array(z.object({ month: z.string(), revenue: z.int() })).nullable(),
    /** Valid receipts by calendar year, the three years up to the year the period ends in; null when hidden too. */
    revenueByYear: z.array(z.object({ year: z.string(), revenue: z.int() })).nullable(),
  })
  .meta({ id: "Overview" });

export type Overview = z.output<typeof overviewSchema>;
