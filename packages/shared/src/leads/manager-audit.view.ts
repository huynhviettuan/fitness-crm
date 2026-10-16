import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { instant, pageOf } from "../validation/index.js";
import { AUDIT_RESULTS } from "./manager-audit.schema.js";
import { LEAD_STATUSES } from "./lead.schema.js";

const person = z.object({ id: z.uuid(), name: z.string() });

/** One grade of a manager, with the criteria not met (A-086, A-087). */
export const managerAuditSchema = z
  .object({
    id: z.uuid(),
    result: z.enum(AUDIT_RESULTS),
    comment: z.string().nullable(),
    /** The criteria a Fail names; none for a Pass. */
    criteria: z.array(chosenOptionSchema),
    auditor: person,
    at: instant,
  })
  .meta({ id: "ManagerAudit" });

/** Every grade of a lead, newest first: the first is the one that counts. */
export const managerAuditListSchema = z.object({ items: z.array(managerAuditSchema) }).meta({ id: "ManagerAuditList" });

/** A row of the queue "Chưa audit" (A-088). */
export const unauditedLeadSchema = z
  .object({
    id: z.uuid(),
    leadCode: z.string(),
    fullName: z.string(),
    status: z.enum(LEAD_STATUSES),
    pic: person.nullable(),
    branch: branchRefSchema,
    createdAt: instant,
  })
  .meta({ id: "UnauditedLead" });

export const unauditedLeadsPageSchema = pageOf(unauditedLeadSchema).meta({ id: "UnauditedLeadsPage" });

export type ManagerAudit = z.output<typeof managerAuditSchema>;
export type UnauditedLead = z.output<typeof unauditedLeadSchema>;
export type UnauditedLeadsPage = z.output<typeof unauditedLeadsPageSchema>;
