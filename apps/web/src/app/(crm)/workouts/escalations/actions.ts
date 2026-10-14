"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { markEscalationSeen } from "@/lib/api/workout-escalations";
import type { EscalationSeenInput } from "@flow/shared/workouts";

// The write of an escalation (M7.4): the manager or the Master marks it seen with a direction.

export async function markSeenAction(id: string, input: EscalationSeenInput): Promise<ActionResult> {
  return runAction(async () => {
    await markEscalationSeen(id, input);
  });
}
