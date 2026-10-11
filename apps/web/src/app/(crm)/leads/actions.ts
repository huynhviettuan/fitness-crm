"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { assignLead, changeLeadStatus, createLead, updateLead } from "@/lib/api/leads";
import type { LeadAssignInput, LeadInput, LeadStatusChangeInput, LeadUpdateInput } from "@flow/shared/leads";

export async function createLeadAction(input: LeadInput): Promise<ActionResult<{ id: string; leadCode: string }>> {
  return runAction(async () => {
    const lead = await createLead(input);
    return { id: lead.id, leadCode: lead.leadCode };
  });
}

export async function updateLeadAction(id: string, input: LeadUpdateInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateLead(id, input);
  });
}

export async function changeLeadStatusAction(id: string, input: LeadStatusChangeInput): Promise<ActionResult> {
  return runAction(async () => {
    await changeLeadStatus(id, input);
  });
}

export async function assignLeadAction(id: string, input: LeadAssignInput): Promise<ActionResult> {
  return runAction(async () => {
    await assignLead(id, input);
  });
}
