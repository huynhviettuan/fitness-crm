import { apiErrorSchema, type DuplicatePerson, type ErrorCode, type FieldErrors } from "@flow/shared/errors";

export type { DuplicatePerson, ErrorCode, FieldErrors };

// A body outside the error contract (e.g. from a proxy in between): the status decides.
const UNDOCUMENTED_STATUS: Record<number, ErrorCode> = { 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND" };

/** An error answer from the API, in the documented format (docs/07 "Error contract"). */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;
  /** PHONE_ALREADY_USED: the person who has the phone, when the user may see them (D-019). */
  readonly duplicate?: DuplicatePerson;

  constructor(code: ErrorCode, options?: { message?: string; fieldErrors?: FieldErrors; duplicate?: DuplicatePerson }) {
    super(options?.message ?? code);
    this.name = "ApiError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
    this.duplicate = options?.duplicate;
  }

  /** From a response the API sent; anything unexpected becomes INTERNAL_ERROR. */
  static fromResponse(status: number, body: unknown): ApiError {
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { fieldErrors, duplicate } = parsed.data.details;
      return new ApiError(parsed.data.code, { message: parsed.data.message, fieldErrors, duplicate });
    }
    return new ApiError(UNDOCUMENTED_STATUS[status] ?? "INTERNAL_ERROR", { message: `API answered ${status}` });
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
