"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { setLeadReceiver } from "@/lib/api/lead-receivers";
import type { LeadReceiverInput } from "@gymcrm/shared/leads";

export async function setLeadReceiverAction(userId: string, input: LeadReceiverInput): Promise<ActionResult> {
  return runAction(async () => {
    await setLeadReceiver(userId, input);
  });
}
