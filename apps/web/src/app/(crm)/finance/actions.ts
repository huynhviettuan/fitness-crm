"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { requireActionUser } from "@/lib/auth/current-user";
import { recordCashTransaction, voidCashTransaction } from "@/modules/finance/cash.service";
import { recordPayment, voidPayment } from "@/modules/finance/payment.service";
import type { CashTransactionInput, PaymentInput, VoidInput } from "@flow/shared/finance";

/** `idempotencyKey` is generated when the form opens, so a double submit reuses it (T-015). */
export async function recordPaymentAction(contractId: string, input: PaymentInput, idempotencyKey: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await recordPayment(user, contractId, input, idempotencyKey);
  });
}

export async function voidPaymentAction(id: string, input: VoidInput): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await voidPayment(user, id, input);
  });
}

export async function recordCashTransactionAction(input: CashTransactionInput, idempotencyKey: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await recordCashTransaction(user, input, idempotencyKey);
  });
}

export async function voidCashTransactionAction(id: string, input: VoidInput): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await voidCashTransaction(user, id, input);
  });
}
