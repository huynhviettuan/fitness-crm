"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { saveAuditCriteria } from "@/lib/api/lead-audit";
import type { CriteriaInput } from "@flow/shared/leads";

export async function saveAuditCriteriaAction(input: CriteriaInput): Promise<ActionResult> {
  return runAction(async () => {
    await saveAuditCriteria(input);
  });
}
