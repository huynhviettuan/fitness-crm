"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createCustomer, updateCustomer } from "@/lib/api/customers";
import type { CreateCustomerInput, UpdateCustomerInput } from "@flow/shared/customers";

export async function createCustomerAction(
  input: CreateCustomerInput,
): Promise<ActionResult<{ id: string; customerCode: string }>> {
  return runAction(async () => {
    const customer = await createCustomer(input);
    return { id: customer.id, customerCode: customer.customerCode };
  });
}

export async function updateCustomerAction(
  id: string,
  input: UpdateCustomerInput,
): Promise<ActionResult<{ submitted: boolean }>> {
  return runAction(async () => ({ submitted: (await updateCustomer(id, input)).submitted }));
}
