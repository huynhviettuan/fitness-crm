"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { activateContract, cancelContract, createContract, updateContract } from "@/lib/api/contracts";
import type { ContractInput } from "@flow/shared/contracts";

/** `idempotencyKey` is generated when the form opens, so a double submit reuses it (T-015). */
export async function createContractAction(
  customerId: string,
  input: ContractInput,
  idempotencyKey: string,
): Promise<ActionResult<{ id: string; contractCode: string }>> {
  return runAction(async () => {
    const contract = await createContract(customerId, input, idempotencyKey);
    return { id: contract.id, contractCode: contract.contractCode };
  });
}

export async function updateContractAction(id: string, input: ContractInput): Promise<ActionResult> {
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
