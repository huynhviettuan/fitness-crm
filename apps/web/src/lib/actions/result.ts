import "server-only";
import { unstable_rethrow } from "next/navigation";
import { isApiError, type ErrorCode, type FieldErrors } from "@/lib/api/errors";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; fieldErrors?: FieldErrors };

/**
 * Runs a Server Action body and turns API errors into a serializable result the form
 * can show. Unexpected errors are logged and reported as INTERNAL_ERROR.
 */
export async function runAction<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await body() };
  } catch (error) {
    // Let Next.js handle redirect() and notFound().
    unstable_rethrow(error);
    if (isApiError(error)) return { ok: false, code: error.code, fieldErrors: error.fieldErrors };
    console.error("Unhandled Server Action error", error);
    return { ok: false, code: "INTERNAL_ERROR" };
  }
}
