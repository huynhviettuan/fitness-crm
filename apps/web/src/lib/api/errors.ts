import { apiErrorSchema, type ErrorCode, type FieldErrors } from "@flow/shared/errors";

export type { ErrorCode, FieldErrors };

// A body outside the error contract (e.g. from a proxy in between): the status decides.
const UNDOCUMENTED_STATUS: Record<number, ErrorCode> = { 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND" };

/** An error answer from the API, in the documented format (docs/07 "Error contract"). */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;

  constructor(code: ErrorCode, options?: { message?: string; fieldErrors?: FieldErrors }) {
    super(options?.message ?? code);
    this.name = "ApiError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
  }

  /** From a response the API sent; anything unexpected becomes INTERNAL_ERROR. */
  static fromResponse(status: number, body: unknown): ApiError {
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      return new ApiError(parsed.data.code, { message: parsed.data.message, fieldErrors: parsed.data.details.fieldErrors });
    }
    return new ApiError(UNDOCUMENTED_STATUS[status] ?? "INTERNAL_ERROR", { message: `API answered ${status}` });
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
