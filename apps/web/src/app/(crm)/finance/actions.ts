"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { deleteCashTransaction, deletePayment, recordCashTransaction, recordPayment } from "@/lib/api/finance";
import type { CashTransactionInput, PaymentInput } from "@flow/shared/finance";
import type { DeleteInput } from "@flow/shared/trash";

/** `idempotencyKey` is generated when the form opens, so a double submit reuses it (T-015). */
export async function recordPaymentAction(contractId: string, input: PaymentInput, idempotencyKey: string): Promise<ActionResult> {
  return runAction(async () => {
    await recordPayment(contractId, input, idempotencyKey);
  });
}

export async function deletePaymentAction(id: string, input: DeleteInput): Promise<ActionResult> {
  return runAction(async () => {
    await deletePayment(id, input);
  });
}

export async function recordCashTransactionAction(input: CashTransactionInput, idempotencyKey: string): Promise<ActionResult> {
  return runAction(async () => {
    await recordCashTransaction(input, idempotencyKey);
  });
}

export async function deleteCashTransactionAction(id: string, input: DeleteInput): Promise<ActionResult> {
  return runAction(async () => {
    await deleteCashTransaction(id, input);
  });
}
