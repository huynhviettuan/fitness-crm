"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createBranch, updateBranch } from "@/lib/api/branches";
import type { BranchInput } from "@flow/shared/branches";

export async function createBranchAction(input: BranchInput): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const branch = await createBranch(input);
    return { name: branch.name };
  });
}

export async function updateBranchAction(id: string, input: BranchInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateBranch(id, input);
  });
}
