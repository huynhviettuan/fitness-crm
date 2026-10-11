"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createLead, updateLead } from "@/lib/api/leads";
import type { LeadInput, LeadUpdateInput } from "@flow/shared/leads";

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
