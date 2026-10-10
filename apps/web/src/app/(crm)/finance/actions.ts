"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { recordCashTransaction, voidCashTransaction, recordPayment, voidPayment } from "@/lib/api/finance";
import type { CashTransactionInput, PaymentInput, VoidInput } from "@flow/shared/finance";

/** `idempotencyKey` is generated when the form opens, so a double submit reuses it (T-015). */
export async function recordPaymentAction(contractId: string, input: PaymentInput, idempotencyKey: string): Promise<ActionResult> {
  return runAction(async () => {
    await recordPayment(contractId, input, idempotencyKey);
  });
}

export async function voidPaymentAction(id: string, input: VoidInput): Promise<ActionResult> {
  return runAction(async () => {
    await voidPayment(id, input);
  });
}

export async function recordCashTransactionAction(input: CashTransactionInput, idempotencyKey: string): Promise<ActionResult> {
  return runAction(async () => {
    await recordCashTransaction(input, idempotencyKey);
  });
}

export async function voidCashTransactionAction(id: string, input: VoidInput): Promise<ActionResult> {
  return runAction(async () => {
    await voidCashTransaction(id, input);
  });
}
