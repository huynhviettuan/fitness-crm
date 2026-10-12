"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createScript, reorderScripts, updateScript } from "@/lib/api/scripts";
import type { ScriptInput } from "@flow/shared/leads";

export async function createScriptAction(input: ScriptInput): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => ({ name: (await createScript(input)).situationVi }));
}

export async function updateScriptAction(id: string, input: ScriptInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateScript(id, input);
  });
}

export async function reorderScriptsAction(scriptIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    await reorderScripts(scriptIds);
  });
}
