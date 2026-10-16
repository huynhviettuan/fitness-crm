"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createOption, reorderOptions, updateOption } from "@/lib/api/configuration";
import type { OptionInput, OptionListKey } from "@gymcrm/shared/options";

export async function createOptionAction(
  listKey: OptionListKey,
  input: OptionInput,
): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const option = await createOption(listKey, input);
    return { name: option.labelVi };
  });
}

export async function updateOptionAction(
  listKey: OptionListKey,
  id: string,
  input: OptionInput,
): Promise<ActionResult> {
  return runAction(async () => {
    await updateOption(listKey, id, input);
  });
}

export async function reorderOptionsAction(listKey: OptionListKey, optionIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    await reorderOptions(listKey, optionIds);
  });
}
