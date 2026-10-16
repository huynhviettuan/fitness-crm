"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createPromotion, updatePromotion } from "@/lib/api/promotions";
import type { PromotionInput } from "@gymcrm/shared/promotions";

export async function createPromotionAction(input: PromotionInput): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => ({ name: (await createPromotion(input)).name }));
}

export async function updatePromotionAction(
  id: string,
  input: PromotionInput,
): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => ({ name: (await updatePromotion(id, input)).name }));
}
