// Stable machine-readable error codes (docs/07_API_SPECIFICATION.md, "Error contract").
// Add a code here, to the docs/07 table, and to messages/*.json `errors` together.
export const ERROR_HTTP_STATUS = {
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_ALREADY_USED: 409,
  CANNOT_CHANGE_OWN_ACCESS: 409,
  INVALID_STATUS_TRANSITION: 409,
  CONTRACT_NOT_EDITABLE: 409,
  CONTRACT_NOT_ACTIVE: 409,
  CONTRACT_NO_REMAINING_SESSIONS: 409,
  CONTRACT_HAS_CHECKED_IN_BOOKING: 409,
  PAYMENT_CONTRACT_CANCELLED: 409,
  BOOKING_TRAINER_OVERLAP: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
  BOOKING_CUSTOMER_CONTRACT_MISMATCH: 422,
  BOOKING_OUTSIDE_CONTRACT_PERIOD: 422,
  PAYMENT_EXCEEDS_CONTRACT_VALUE: 422,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export type FieldErrors = Record<string, string[]>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;

  constructor(code: ErrorCode, options?: { message?: string; fieldErrors?: FieldErrors }) {
    super(options?.message ?? code);
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
  }

  get httpStatus(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
