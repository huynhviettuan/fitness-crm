import { z } from "zod";
import { hasNoControlCharacters, normalizePhone, parseDateOnly } from "../validation/index.js";

// Show (brief §3 stage 3, §4.1; D-019, D-036, D-042): the lead came in and becomes a
// customer in the same record. Converting needs the ID document, birth date, nationality,
// email, and a phone, and the customer's consent to keep the ID and health data.

/** Citizen ID card (CCCD, 12 digits) or passport. */
export const ID_DOCUMENT_TYPES = ["CCCD", "PASSPORT"] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });

export const showInputSchema = z
  .object({
    idDocumentType: z.enum(ID_DOCUMENT_TYPES, { error: "invalidChoice" }),
    /** Spaces and dashes are dropped, letters capitalized. */
    idDocumentNumber: z
      .string()
      .transform((value) => value.replace(/[\s-]/g, "").toUpperCase())
      .pipe(z.string().min(1, { error: "required" })),
    // dd/MM/yyyy, not in the future.
    birthDate: z.string().transform((value, ctx) => {
      const date = parseDateOnly(value.trim());
      if (!date || date.getTime() > Date.now()) {
        ctx.addIssue({ code: "custom", message: value.trim() === "" ? "required" : "invalidDate" });
        return z.NEVER;
      }
      return date;
    }),
    nationality: text(100).pipe(z.string().min(1, { error: "required" })),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email({ error: "invalidEmail" })),
    phone: z
      .string()
      .trim()
      .min(1, { error: "required" })
      .transform(normalizePhone)
      .pipe(z.string().regex(/^\+?\d{8,15}$/, { error: "invalidPhone" })),
    /** Basic health information (brief §3 stage 2), optional; encrypted at rest. */
    healthNote: text(1000)
      .transform((value) => (value === "" ? null : value))
      .prefault(""),
    /** D-042: the customer agrees that the ID and health data are kept. */
    consent: z.literal(true, { error: "consentRequired" }),
  })
  .superRefine((value, ctx) => {
    const valid =
      value.idDocumentType === "CCCD"
        ? /^\d{12}$/.test(value.idDocumentNumber)
        : /^[A-Z0-9]{6,20}$/.test(value.idDocumentNumber);
    if (!valid) ctx.addIssue({ code: "custom", path: ["idDocumentNumber"], message: "invalidIdDocument" });
  });

/** After Show the record is a customer: open it at /customers/{customerId}. */
export const showResultSchema = z.object({ customerId: z.uuid() }).meta({ id: "LeadShown" });

export type ShowInput = z.input<typeof showInputSchema>;
export type ShowData = z.output<typeof showInputSchema>;
