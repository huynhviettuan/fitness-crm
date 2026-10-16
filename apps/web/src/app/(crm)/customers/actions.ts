"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createCustomer, updateCustomer } from "@/lib/api/customers";
import { getCustomerEmail } from "@/lib/api/mail";
import type { CreateCustomerInput, UpdateCustomerInput } from "@gymcrm/shared/customers";
import type { EmailMessageDetail } from "@gymcrm/shared/mail";

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

/** One email to the customer with its body, for the "Emails sent" tab (A-317). */
export async function getCustomerEmailAction(
  customerId: string,
  emailId: string,
): Promise<ActionResult<EmailMessageDetail>> {
  return runAction(() => getCustomerEmail(customerId, emailId));
}
