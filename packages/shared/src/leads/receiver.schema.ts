import { z } from "zod";
import { listOf } from "../validation/index.js";

// Who receives leads and how often (D-050): admin and managers switch a consultant's receiving
// on or off and set the turn weight. Error messages are i18n keys under `validation.*`.

export const LEAD_WEIGHT_MAX = 20;

export const leadReceiverInputSchema = z.object({
  /** Off for a while (leave, busy): no new lead is dealt to them (D-050). */
  receivesLeads: z.boolean({ error: "invalidChoice" }),
  /** A weight of 2 takes two leads in a round where a weight of 1 takes one; initially 1. */
  leadWeight: z
    .int({ error: "invalidNumber" })
    .min(1, { error: "outOfRange" })
    .max(LEAD_WEIGHT_MAX, { error: "outOfRange" }),
});
export type LeadReceiverInput = z.input<typeof leadReceiverInputSchema>;

export const leadReceiverSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    role: z.object({ id: z.uuid(), name: z.string() }),
    allBranches: z.boolean(),
    branches: z.array(z.object({ id: z.uuid(), name: z.string() })),
    receivesLeads: z.boolean(),
    leadWeight: z.int(),
    /** Within their access windows now (D-050); a person with none is always on duty. */
    onDuty: z.boolean(),
    /** Leads they have in consulting now. */
    leadsInCharge: z.int(),
  })
  .meta({ id: "LeadReceiver" });

export const leadReceiverListSchema = listOf(leadReceiverSchema).meta({ id: "LeadReceiverList" });

export type LeadReceiver = z.output<typeof leadReceiverSchema>;
