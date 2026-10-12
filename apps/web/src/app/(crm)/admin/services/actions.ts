"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { quotePrice } from "@/lib/api/promotions";
import { createService, saveQuickPackages, saveTiers, updateService } from "@/lib/api/services";
import type { PriceQuote } from "@flow/shared/promotions";
import type { QuickPackagesInput, ServiceInput, TiersInput } from "@flow/shared/services";

export async function createServiceAction(input: ServiceInput): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const service = await createService(input);
    return { id: service.id, name: service.name };
  });
}

export async function updateServiceAction(id: string, input: ServiceInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateService(id, input);
  });
}

export async function saveTiersAction(id: string, input: TiersInput): Promise<ActionResult> {
  return runAction(async () => {
    await saveTiers(id, input);
  });
}

export async function saveQuickPackagesAction(id: string, input: QuickPackagesInput): Promise<ActionResult> {
  return runAction(async () => {
    await saveQuickPackages(id, input);
  });
}

export async function quotePriceAction(
  id: string,
  params: { sessions: string; startDate?: string; promotionId?: string; voucherCode?: string; vatPercent?: string },
): Promise<ActionResult<PriceQuote>> {
  return runAction(() => quotePrice(id, params));
}
