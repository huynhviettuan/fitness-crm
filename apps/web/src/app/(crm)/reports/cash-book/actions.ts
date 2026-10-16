"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { setCashOpening } from "@/lib/api/reports";
import type { CashOpeningInput } from "@gymcrm/shared/finance";

/** Sets the opening balance of a branch and payment method: Admin's, audited by the API (A-138). */
export async function setCashOpeningAction(input: CashOpeningInput): Promise<ActionResult> {
  return runAction(async () => {
    await setCashOpening(input);
  });
}
