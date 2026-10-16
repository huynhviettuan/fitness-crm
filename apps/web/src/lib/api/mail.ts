import "server-only";
import {
  emailMessageDetailSchema,
  emailMessagePageSchema,
  emailTemplateListSchema,
  emailTemplateSchema,
  type EmailTemplateInput,
} from "@gymcrm/shared/mail";
import { api, query, read } from "./client";

/** The emails sent to one customer, newest first (FR-MAIL-003). */
export async function listCustomerEmails(customerId: string, params: { page?: number; pageSize?: number } = {}) {
  return read(
    emailMessagePageSchema,
    (await api()).GET("/api/v1/customers/{id}/emails", { params: { path: { id: customerId }, query: query(params) } }),
  );
}

/** One email with what it said (A-317). */
export async function getCustomerEmail(customerId: string, emailId: string) {
  return read(
    emailMessageDetailSchema,
    (await api()).GET("/api/v1/customers/{id}/emails/{emailId}", { params: { path: { id: customerId, emailId } } }),
  );
}

// The words of each customer email (M6.2, FR-MAIL-001).

export async function listEmailTemplates() {
  const { items } = await read(emailTemplateListSchema, (await api()).GET("/api/v1/email-templates"));
  return items;
}

export async function getEmailTemplate(event: string) {
  return read(
    emailTemplateSchema,
    (await api()).GET("/api/v1/email-templates/{event}", { params: { path: { event } } }),
  );
}

export async function updateEmailTemplate(event: string, input: EmailTemplateInput) {
  return read(
    emailTemplateSchema,
    (await api()).PUT("/api/v1/email-templates/{event}", { params: { path: { event } }, body: input }),
  );
}
