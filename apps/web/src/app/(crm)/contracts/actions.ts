"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { requireActionUser } from "@/lib/auth/current-user";
import { activateContract, cancelContract, createContract, updateContract } from "@/modules/contracts/contract.service";
import type { ContractInput } from "@flow/shared/contracts";

/** `idempotencyKey` is generated when the form opens, so a double submit reuses it (T-015). */
export async function createContractAction(
  customerId: string,
  input: ContractInput,
  idempotencyKey: string,
): Promise<ActionResult<{ id: string; contractCode: string }>> {
  return runAction(async () => {
    const user = await requireActionUser();
    const { contract } = await createContract(user, customerId, input, idempotencyKey);
    return { id: contract.id, contractCode: contract.contractCode };
  });
}

export async function updateContractAction(id: string, input: ContractInput): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await updateContract(user, id, input);
  });
}

export async function activateContractAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await activateContract(user, id);
  });
}

export async function cancelContractAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await cancelContract(user, id);
  });
}
