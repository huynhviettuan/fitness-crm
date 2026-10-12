import "server-only";
import { emailMessagePageSchema } from "@flow/shared/mail";
import { api, query, read } from "./client";

/** The emails sent to one customer, newest first (FR-MAIL-003). */
export async function listCustomerEmails(customerId: string, params: { page?: number; pageSize?: number } = {}) {
  return read(
    emailMessagePageSchema,
    (await api()).GET("/api/v1/customers/{id}/emails", { params: { path: { id: customerId }, query: query(params) } }),
  );
}
