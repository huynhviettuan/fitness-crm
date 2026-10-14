"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createIntakeSource, rotateIntakeSourceKey, updateIntakeSource } from "@/lib/api/intake";
import type { IntakeSourceInput, IntakeSourceUpdate } from "@flow/shared/intake";

// The writes of the lead sources (M10.1, D-044).

export async function createSourceAction(input: IntakeSourceInput): Promise<ActionResult<{ key: string }>> {
  return runAction(async () => ({ key: (await createIntakeSource(input)).key }));
}

export async function updateSourceAction(id: string, input: IntakeSourceUpdate): Promise<ActionResult> {
  return runAction(async () => {
    await updateIntakeSource(id, input);
  });
}

export async function rotateSourceKeyAction(id: string): Promise<ActionResult<{ key: string }>> {
  return runAction(async () => ({ key: (await rotateIntakeSourceKey(id)).key }));
}
