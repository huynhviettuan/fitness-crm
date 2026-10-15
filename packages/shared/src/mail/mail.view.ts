import { z } from "zod";
import { instant, pageOf } from "../validation/index.js";
import { EMAIL_FAILURES, EMAIL_LOCALES, EMAIL_STATUSES } from "./mail.domain.js";

/** The "Emails sent" tab of a customer (FR-MAIL-003). The address is null when the role may not see emails. */
export const emailMessageSchema = z
  .object({
    id: z.uuid(),
    event: z.string(),
    subject: z.string(),
    toAddress: z.string().nullable(),
    locale: z.enum(EMAIL_LOCALES),
    status: z.enum(EMAIL_STATUSES),
    attempts: z.number().int(),
    failure: z.enum(EMAIL_FAILURES).nullable(),
    createdAt: instant,
    sentAt: instant.nullable(),
    /** Recorded but never delivered: the server writes emails to its log instead of sending them (trial, A-317). */
    recordedOnly: z.boolean(),
  })
  .meta({ id: "EmailMessage" });
export type EmailMessage = z.infer<typeof emailMessageSchema>;

/** One email with what it said (A-317): the subject and the plain-text body, as rendered when it was queued. */
export const emailMessageDetailSchema = emailMessageSchema
  .extend({ body: z.string() })
  .meta({ id: "EmailMessageDetail" });
export type EmailMessageDetail = z.infer<typeof emailMessageDetailSchema>;

export const emailMessagePageSchema = pageOf(emailMessageSchema).meta({ id: "EmailMessagePage" });
export type EmailMessagePage = z.infer<typeof emailMessagePageSchema>;

export const listEmailsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});
