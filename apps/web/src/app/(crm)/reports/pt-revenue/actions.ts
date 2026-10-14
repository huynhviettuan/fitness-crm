"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createPayout } from "@/lib/api/payouts";
import type { PtPayoutInput } from "@flow/shared/payouts";

/** Pays a PT the sessions of a period not paid yet (M5.7); `pending` when the voucher waits for approval (D-018). */
export async function createPayoutAction(
  input: PtPayoutInput,
  idempotencyKey: string,
): Promise<ActionResult<{ pending: boolean; amount: number; number: string }>> {
  return runAction(async () => {
    const payout = await createPayout(input, idempotencyKey);
    return { pending: payout.approvalStatus === "PENDING", amount: payout.amount, number: payout.number };
  });
}
