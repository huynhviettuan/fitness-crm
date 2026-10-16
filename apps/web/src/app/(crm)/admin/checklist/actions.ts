"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { saveChecklist } from "@/lib/api/leads";
import type { ChecklistInput } from "@gymcrm/shared/leads";

export async function saveChecklistAction(input: ChecklistInput): Promise<ActionResult<{ version: number }>> {
  return runAction(async () => {
    const checklist = await saveChecklist(input);
    return { version: checklist.version };
  });
}
