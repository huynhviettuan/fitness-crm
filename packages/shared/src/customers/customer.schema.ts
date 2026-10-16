import { z } from "zod";
import { branchChoice } from "../branches/branch.schema.js";
import { calendarDate, parseDateOnly, normalizePhone, hasNoControlCharacters } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
export const CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE"] as const;

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

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: "tooLong" })
    .refine(hasNoControlCharacters, { error: "invalidCharacters" })
    .transform(emptyToNull);

/** Optional: the emergency contact's phone. */
const optionalPhone = z
  .string()
  .trim()
  .transform(normalizePhone)
  .pipe(z.union([z.literal(""), z.string().regex(/^\+?\d{8,15}$/, { error: "invalidPhone" })]))
  .transform(emptyToNull);

/** "" or null for none. */
const optionalChoice = z.preprocess(
  (value) => (value === "" ? null : value),
  z.uuid({ error: "invalidChoice" }).nullable(),
);

/**
 * The profile of brief §4.2 beyond the identity (A-069 to A-071). The address and the
 * emergency contact are hidden together; the group is from "customerGroups" (D-016);
 * the staff in charge is an active user of the customer's branch.
 */
const profileFields = {
  address: optionalText(300),
  emergencyContactName: optionalText(150),
  emergencyContactPhone: optionalPhone,
  customerGroupId: optionalChoice,
  customerGroupNote: optionalText(500),
  staffInChargeId: optionalChoice,
};

export const createCustomerSchema = z.object({
  branchId: branchChoice,
  fullName,
  phone,
  email: email.prefault(""),
  dateOfBirth: dateOfBirth.prefault(""),
  notes: notes.prefault(""),
  address: profileFields.address.prefault(""),
  emergencyContactName: profileFields.emergencyContactName.prefault(""),
  emergencyContactPhone: profileFields.emergencyContactPhone.prefault(""),
  customerGroupId: profileFields.customerGroupId.prefault(""),
  customerGroupNote: profileFields.customerGroupNote.prefault(""),
  staffInChargeId: profileFields.staffInChargeId.prefault(""),
});

// customerCode is not editable (BR-001), so it is not part of the schema.
export const updateCustomerSchema = z
  .object({
    fullName,
    phone,
    email,
    dateOfBirth,
    notes,
    status: z.enum(CUSTOMER_STATUSES),
    ...profileFields,
  })
  .partial();

/** Forms send "" for a filter left empty. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const listCustomersSchema = z.object({
  q: z.string().trim().max(100).refine(hasNoControlCharacters).optional().default(""),
  // Filters of FR-CUS-003 (A-075): branch, staff in charge, registration days, birthday month, no email.
  branchId: optional(z.uuid({ error: "invalidChoice" })),
  staffId: optional(z.uuid({ error: "invalidChoice" })),
  /** First and last gym day of registration, dd/MM/yyyy. */
  registeredFrom: optional(calendarDate),
  registeredTo: optional(calendarDate),
  birthdayMonth: optional(
    z.coerce.number().int().min(1, { error: "invalidChoice" }).max(12, { error: "invalidChoice" }),
  ),
  noEmail: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .prefault(false),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type CreateCustomerInput = z.input<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.output<typeof listCustomersSchema>;
