"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import {
  deleteCashTransaction,
  deletePayment,
  recordCashTransaction,
  recordPayment,
  updateReceiptDate,
} from "@/lib/api/finance";
import type { CashTransactionInput, PaymentInput } from "@flow/shared/finance";
import type { DeleteInput } from "@flow/shared/trash";

/** `idempotencyKey` is generated when the form opens, so a double submit reuses it (T-015). */
/** `pending`: the payment waits for approval and does not count yet (D-018). */
export async function recordPaymentAction(
  contractId: string,
  input: PaymentInput,
  idempotencyKey: string,
): Promise<ActionResult<{ pending: boolean }>> {
  return runAction(async () => {
    const payment = await recordPayment(contractId, input, idempotencyKey);
    return { pending: payment.approvalStatus === "PENDING" };
  });
}

export async function updateReceiptDateAction(id: string, input: { paidOn: string }): Promise<ActionResult> {
  return runAction(async () => {
    await updateReceiptDate(id, input);
  });
}

/** `submitted`: the deletion waits for approval (D-018). */
export async function deletePaymentAction(
  id: string,
  input: DeleteInput,
): Promise<ActionResult<{ submitted: boolean }>> {
  return runAction(async () => ({ submitted: await deletePayment(id, input) }));
}

export async function recordCashTransactionAction(
  input: CashTransactionInput,
  idempotencyKey: string,
): Promise<ActionResult<{ pending: boolean }>> {
  return runAction(async () => {
    const transaction = await recordCashTransaction(input, idempotencyKey);
    return { pending: transaction.approvalStatus === "PENDING" };
  });
}

export async function deleteCashTransactionAction(
  id: string,
  input: DeleteInput,
): Promise<ActionResult<{ submitted: boolean }>> {
  return runAction(async () => ({ submitted: await deleteCashTransaction(id, input) }));
}
