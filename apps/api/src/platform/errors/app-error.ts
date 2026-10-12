import { ERROR_HTTP_STATUS, type DuplicatePerson, type ErrorCode, type FieldErrors } from "@flow/shared/errors";

export type { ErrorCode, FieldErrors };

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;
  /** PHONE_ALREADY_USED: the record that has the phone, when the user may see it (D-019). */
  readonly duplicate?: DuplicatePerson;
  /** EXPORT_TOO_LARGE: the row limit and the list's row count (A-078). */
  readonly exportLimit?: { limit: number; total: number };

  constructor(
    code: ErrorCode,
    options?: {
      message?: string;
      fieldErrors?: FieldErrors;
      duplicate?: DuplicatePerson;
      exportLimit?: { limit: number; total: number };
    },
  ) {
    super(options?.message ?? code);
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
    this.duplicate = options?.duplicate;
    this.exportLimit = options?.exportLimit;
  }

  get httpStatus(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
