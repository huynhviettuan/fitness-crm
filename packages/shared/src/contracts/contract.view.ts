import { z } from "zod";
import { customerRefSchema } from "../customers/customer.view.js";
import { instant, pageOf } from "../validation/index.js";
import { CONTRACT_STATUSES } from "./contract.domain.js";

/** What the UI and API see: plain numbers and the effective status (T-018). */
export const contractSchema = z
  .object({
    id: z.uuid(),
    contractCode: z.string(),
    customer: customerRefSchema,
    packageName: z.string(),
    startDate: instant,
    endDate: instant,
    status: z.enum([...CONTRACT_STATUSES, "EXPIRED"]),
    createdAt: instant,
    // Derived figures (T-012, BR-013, D-011).
    totalSessions: z.int(),
    openingSessionsUsed: z.int(),
    completedSessions: z.int(),
    remainingSessions: z.int(),
    contractValue: z.int(),
    openingPaidAmount: z.int(),
    confirmedPaidAmount: z.int(),
    paidAmount: z.int(),
    debt: z.int(),
  })
  .meta({ id: "Contract" });

export const contractPageSchema = pageOf(contractSchema).meta({ id: "ContractPage" });

export type Contract = z.output<typeof contractSchema>;
export type ContractPage = z.output<typeof contractPageSchema>;
