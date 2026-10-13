import { z } from "zod";

// Stable machine-readable error codes (docs/07_API_SPECIFICATION.md, "Error contract").
// Add a code here, to the docs/07 table, and to the web app's messages/*.json `errors` together.
export const ERROR_HTTP_STATUS = {
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  // D-018: nobody decides their own request, whatever their rights.
  APPROVAL_OWN_REQUEST: 403,
  NOT_FOUND: 404,
  EMAIL_ALREADY_USED: 409,
  // D-019: one person, one record; the answer names the record that has the phone.
  PHONE_ALREADY_USED: 409,
  // D-019, BR-202: the lead intake finds the phone on an existing record and offers to add the inquiry to it.
  DUPLICATE_PHONE: 409,
  // A-064, OQ-033: two customers are not merged in this slice (contracts, receipts, sessions would move).
  MERGE_CUSTOMERS_UNSUPPORTED: 409,
  // One of the two records was already merged into another (also the second of two concurrent merges).
  PERSON_ALREADY_MERGED: 409,
  CANNOT_CHANGE_OWN_ACCESS: 409,
  INVALID_STATUS_TRANSITION: 409,
  // D-054: the step passed its deadline and the grace period and is "Không thực hiện"; nobody ticks it late.
  STEP_LOCKED: 409,
  CONTRACT_NOT_EDITABLE: 409,
  // D-022, brief §5.4: a contract with receipts or sessions is not deleted (or unapproved); the answer lists them.
  CONTRACT_HAS_DEPENDENTS: 409,
  // A-112: the total discount is above what the approver's role may approve itself.
  DISCOUNT_ABOVE_LIMIT: 409,
  CONTRACT_NOT_ACTIVE: 409,
  // D-023: a deactivated contract is not booked, checked in, or completed until it is reactivated.
  CONTRACT_FROZEN: 409,
  CONTRACT_NO_REMAINING_SESSIONS: 409,
  CONTRACT_HAS_CHECKED_IN_BOOKING: 409,
  PAYMENT_CONTRACT_CANCELLED: 409,
  BOOKING_TRAINER_OVERLAP: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  APPROVAL_NOT_PENDING: 409,
  APPROVAL_ALREADY_PENDING: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
  BOOKING_CUSTOMER_CONTRACT_MISMATCH: 422,
  BOOKING_OUTSIDE_CONTRACT_PERIOD: 422,
  // D-030: only inside the trainer's working hours, never on a day off.
  BOOKING_OUTSIDE_WORKING_HOURS: 422,
  PAYMENT_EXCEEDS_CONTRACT_VALUE: 422,
  // A-078: the list has more rows than `exportRowLimit`; narrow the filters.
  EXPORT_TOO_LARGE: 422,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export type FieldErrors = Record<string, string[]>;

/** The existing record a duplicate phone belongs to (D-019): open it instead of adding another. */
export const duplicatePersonSchema = z.object({
  id: z.uuid(),
  stage: z.enum(["LEAD", "CUSTOMER"]),
  code: z.string(),
  fullName: z.string(),
  /**
   * False when the record is another consultant's lead the user's data scope does not open (D-060):
   * the notice then says who is in charge instead of linking to it.
   */
  openable: z.boolean().default(true),
  /** The person in charge of a lead that is not openable. */
  inCharge: z.string().nullable().optional(),
});
export type DuplicatePerson = z.output<typeof duplicatePersonSchema>;

/** The body of every error response (docs/07 "Error contract"). */
export const apiErrorSchema = z
  .object({
    code: z.enum(Object.keys(ERROR_HTTP_STATUS) as ErrorCode[]),
    message: z.string(),
    details: z.object({
      fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
      /** PHONE_ALREADY_USED, DUPLICATE_PHONE: the person who has the phone, when the user may see them. */
      duplicate: duplicatePersonSchema.optional(),
      /** EXPORT_TOO_LARGE: the most rows an export holds and how many the list has (A-078). */
      exportLimit: z.object({ limit: z.int(), total: z.int() }).optional(),
      /** CONTRACT_HAS_DEPENDENTS: the receipts and sessions to deal with first (at most 20). */
      dependents: z
        .array(z.object({ kind: z.enum(["payment", "booking"]), id: z.uuid(), label: z.string() }))
        .optional(),
    }),
  })
  .meta({ id: "ApiError" });

export type ApiErrorBody = z.output<typeof apiErrorSchema>;
