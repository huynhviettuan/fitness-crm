"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import {
  activateContract,
  cancelContract,
  createContract,
  deactivateContract,
  deleteContract,
  reactivateContract,
  rejectContract,
  unapproveContract,
  updateContract,
  updateContractNote,
} from "@/lib/api/contracts";
import type { RejectInput } from "@gymcrm/shared/approvals";
import type { DeactivateInput, ReactivateInput, UnapproveInput } from "@gymcrm/shared/contracts";
import type { DeleteInput } from "@gymcrm/shared/trash";

/** `idempotencyKey` is generated when the form opens, so a double submit reuses it (T-015). */
export async function createContractAction(
  customerId: string,
  input: unknown,
  idempotencyKey: string,
): Promise<ActionResult<{ id: string; contractCode: string }>> {
  return runAction(async () => {
    const contract = await createContract(customerId, input, idempotencyKey);
    return { id: contract.id, contractCode: contract.contractCode };
  });
}

export async function updateContractAction(id: string, input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    await updateContract(id, input);
  });
}

export async function activateContractAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await activateContract(id);
  });
}

export async function cancelContractAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelContract(id);
  });
}

export async function rejectContractAction(id: string, input: RejectInput): Promise<ActionResult> {
  return runAction(async () => {
    await rejectContract(id, input);
  });
}

export async function unapproveContractAction(id: string, input: UnapproveInput): Promise<ActionResult> {
  return runAction(async () => {
    await unapproveContract(id, input);
  });
}

export async function deleteContractAction(
  id: string,
  input: DeleteInput,
): Promise<ActionResult<{ submitted: boolean }>> {
  return runAction(async () => ({ submitted: await deleteContract(id, input) }));
}

export async function updateContractNoteAction(id: string, input: { notes: string }): Promise<ActionResult> {
  return runAction(async () => {
    await updateContractNote(id, input);
  });
}

export async function deactivateContractAction(id: string, input: DeactivateInput): Promise<ActionResult> {
  return runAction(async () => {
    await deactivateContract(id, input);
  });
}

export async function reactivateContractAction(id: string, input: ReactivateInput): Promise<ActionResult> {
  return runAction(async () => {
    await reactivateContract(id, input);
  });
}
