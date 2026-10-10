import { z } from "zod";
import { parseDateOnly } from "@/lib/format";
import { normalizePhone } from "@/lib/text";
import { hasNoControlCharacters } from "@/lib/validation/text";

// Error messages are i18n keys under `validation.*` in messages/*.json.
// Form inputs send "" for an empty optional field; it is stored as null.
const emptyToNull = (value: string) => (value === "" ? null : value);

const fullName = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .max(150, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" });

const phone = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .transform(normalizePhone)
  .pipe(z.string().regex(/^\+?\d{8,15}$/, { error: "invalidPhone" }));

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.union([z.literal(""), z.email({ error: "invalidEmail" })]))
  .transform(emptyToNull);

// dd/MM/yyyy, not in the future.
const dateOfBirth = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
    const date = parseDateOnly(value);
    if (!date || date.getTime() > Date.now()) {
      ctx.addIssue({ code: "custom", message: "invalidDate" });
      return z.NEVER;
    }
    return date;
  });

const notes = z
  .string()
  .trim()
  .max(1000, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" })
  .transform(emptyToNull);

export const createCustomerSchema = z.object({
  fullName,
  phone,
  email: email.prefault(""),
  dateOfBirth: dateOfBirth.prefault(""),
  notes: notes.prefault(""),
});

// customerCode is not editable (BR-001), so it is not part of the schema.
export const updateCustomerSchema = z
  .object({
    fullName,
    phone,
    email,
    dateOfBirth,
    notes,
    status: z.enum(["ACTIVE", "INACTIVE"]),
  })
  .partial();

export const listCustomersSchema = z.object({
  q: z.string().trim().max(100).refine(hasNoControlCharacters).optional().default(""),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type CreateCustomerInput = z.input<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.output<typeof listCustomersSchema>;
