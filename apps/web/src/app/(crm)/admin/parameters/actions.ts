"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { updateParameters } from "@/lib/api/configuration";
import type { ParametersInput } from "@gymcrm/shared/parameters";

export async function updateParametersAction(input: ParametersInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateParameters(input);
  });
}
