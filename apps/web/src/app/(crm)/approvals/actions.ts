"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { approveRequest, rejectRequest, updateApprovalRule } from "@/lib/api/approvals";
import type { ApprovalAction, ApprovalRuleInput, RejectInput } from "@flow/shared/approvals";

export async function approveAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await approveRequest(id);
  });
}

export async function rejectAction(id: string, input: RejectInput): Promise<ActionResult> {
  return runAction(async () => {
    await rejectRequest(id, input);
  });
}

export async function updateApprovalRuleAction(
  action: ApprovalAction,
  input: ApprovalRuleInput,
): Promise<ActionResult> {
  return runAction(async () => {
    await updateApprovalRule(action, input);
  });
}
