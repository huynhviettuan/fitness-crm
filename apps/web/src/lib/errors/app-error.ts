import { ERROR_HTTP_STATUS, type ErrorCode, type FieldErrors } from "@flow/shared/errors";

export type { ErrorCode, FieldErrors };

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
