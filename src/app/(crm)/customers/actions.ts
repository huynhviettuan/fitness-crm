"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { requireActionUser } from "@/lib/auth/current-user";
import { createCustomer, updateCustomer } from "@/modules/customers/customer.service";
import type { CreateCustomerInput, UpdateCustomerInput } from "@/modules/customers/customer.schema";

export async function createCustomerAction(
  input: CreateCustomerInput,
): Promise<ActionResult<{ id: string; customerCode: string }>> {
  return runAction(async () => {
    const user = await requireActionUser();
    const customer = await createCustomer(user, input);
    return { id: customer.id, customerCode: customer.customerCode };
  });
}

export async function updateCustomerAction(id: string, input: UpdateCustomerInput): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await updateCustomer(user, id, input);
  });
}
