import { z } from "zod";
import { phoneFromWhatsApp } from "./whatsapp.js";

// Meta Lead Ads (Instant Forms on Facebook and Instagram; M10.4; brief §11, D-044; A-281 to A-286). The Page's webhook carries a
// `leadgen` change with only the lead's id; the answers are read from Meta with the Page's token. Both steps are read here, purely:
// the webhook into lead ids, Meta's answer into a name, phone, email and the other answers.

/** The same cap as every message (`MAX_MESSAGE_LENGTH` in the domain). */
const MAX_MESSAGE_LENGTH = 4000;

/** Meta's lead ids are digits; anything else is not a lead id, and never reaches the request to Meta. */
export const LEADGEN_ID_PATTERN = /^\d{1,30}$/;

const changeSchema = z.object({
  field: z.literal("leadgen"),
  value: z.object({
    leadgen_id: z.union([z.string(), z.number()]).transform(String),
    form_id: z.union([z.string(), z.number()]).transform(String).optional(),
    created_time: z.number().optional(),
  }),
});

const payloadSchema = z.object({
  object: z.string().optional(),
  entry: z.array(z.object({ changes: z.array(z.unknown()).optional() })).optional(),
});

export type LeadgenEvent = { leadgenId: string; formId: string | null; createdAt: Date | null };

/** The new form leads in a Page's webhook body; messages and other changes give none. */
export function parseLeadgenPayload(payload: unknown): LeadgenEvent[] {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success || (parsed.data.object !== undefined && parsed.data.object !== "page")) return [];
  const found: LeadgenEvent[] = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const raw of entry.changes ?? []) {
      const change = changeSchema.safeParse(raw);
      if (!change.success || !LEADGEN_ID_PATTERN.test(change.data.value.leadgen_id)) continue;
      const seconds = change.data.value.created_time;
      found.push({
        leadgenId: change.data.value.leadgen_id,
        formId: change.data.value.form_id ?? null,
        createdAt: seconds && seconds > 0 ? new Date(seconds * 1000) : null,
      });
    }
  }
  return found;
}

/** What Meta answers for one lead (`GET /<lead id>?fields=field_data,...`). */
export const graphLeadSchema = z.object({
  id: z.string(),
  created_time: z.string().optional(),
  field_data: z.array(z.object({ name: z.string().max(200), values: z.array(z.string()).optional() })).default([]),
});
export type GraphLead = z.input<typeof graphLeadSchema>;

export type FormLead = { name: string | null; phone: string | null; email: string | null; answers: string };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (value: string, max: number) => value.replace(CONTROL, "").trim().slice(0, max);

/** A phone as a form gives it, in the gym's form: `+84 909 123 456` and `0909123456` are the same number. */
export function phoneFromForm(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith("0")) return digits;
  return phoneFromWhatsApp(digits);
}

const EMAIL = z.email();
const NAME_FIELDS = ["full_name", "name", "ho_va_ten", "ho_ten"];

/**
 * The lead in Meta's answer (A-282): the standard fields `full_name` (or `first_name` and `last_name`), `phone_number` and `email`;
 * every other question is kept as "question: answer" lines, so the consultant sees what the person said.
 */
export function leadFromForm(lead: z.output<typeof graphLeadSchema>): FormLead {
  const values = new Map(lead.field_data.map((field) => [field.name.toLowerCase(), (field.values ?? []).join(", ")]));
  const first = values.get("first_name") ?? "";
  const last = values.get("last_name") ?? "";
  const named = NAME_FIELDS.map((key) => values.get(key)).find((value) => value && value.trim());
  const name = clean(named ?? `${first} ${last}`, 150) || null;
  const phoneText = values.get("phone_number") ?? values.get("phone") ?? "";
  const emailText = clean(values.get("email") ?? "", 254).toLowerCase();
  const used = new Set([...NAME_FIELDS, "first_name", "last_name", "phone_number", "phone", "email"]);
  const answers = lead.field_data
    .filter((field) => !used.has(field.name.toLowerCase()))
    .map((field) => `${clean(field.name, 200)}: ${clean((field.values ?? []).join(", "), 1000)}`)
    .join("\n");
  return {
    name,
    phone: phoneText ? phoneFromForm(phoneText) : null,
    email: EMAIL.safeParse(emailText).success ? emailText : null,
    answers: answers.slice(0, MAX_MESSAGE_LENGTH),
  };
}

/** The Page token Admin pastes from Meta: long, and nothing that could break a header or a log. */
export const pageTokenSchema = z
  .string()
  .trim()
  .min(20, { error: "tooShort" })
  .max(1000, { error: "tooLong" })
  .regex(/^[A-Za-z0-9_\-|.]+$/, { error: "invalidCharacters" });
export const pageTokenInputSchema = z.object({ pageToken: pageTokenSchema }).strict();
