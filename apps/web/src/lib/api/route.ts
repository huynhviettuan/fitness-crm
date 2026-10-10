import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { getSessionUser, type CurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { clientIp, logSecurityEvent } from "@/lib/security/log";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The error body from docs/07 "Error contract". */
function errorResponse(error: AppError): Response {
  return Response.json(
    {
      code: error.code,
      message: error.message,
      details: error.fieldErrors ? { fieldErrors: error.fieldErrors } : {},
    },
    { status: error.httpStatus },
  );
}

/**
 * Wraps a Route Handler: rejects cross-site state changes (CSRF, OWASP A08) and makes
 * every error leave in the documented format without internals (A10).
 */
export function handleApi<Rest extends unknown[]>(handler: (request: Request, ...rest: Rest) => Promise<Response>) {
  return async (request: Request, ...rest: Rest): Promise<Response> => {
    try {
      assertSameOrigin(request);
      return await handler(request, ...rest);
    } catch (error) {
      // Let Next.js internal control flow (e.g. prerender bail-out) through.
      unstable_rethrow(error);
      if (isAppError(error)) return errorResponse(error);
      console.error("Unhandled API error", error);
      return errorResponse(new AppError("INTERNAL_ERROR"));
    }
  };
}

/**
 * Session cookies are SameSite=Lax, but a state-changing request must also prove it
 * came from this app: browsers always send Origin on POST/PATCH/DELETE. A request with
 * no Origin is refused too (fail closed).
 */
function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin === new URL(env.BETTER_AUTH_URL).origin) return;

  logSecurityEvent("request.cross_origin_rejected", {
    method: request.method,
    path: new URL(request.url).pathname,
    origin,
    ip: clientIp(request.headers),
  });
  throw new AppError("FORBIDDEN", { message: "Cross-origin request rejected" });
}

export async function requireApiUser(request: Request): Promise<CurrentUser> {
  const user = await getSessionUser(request.headers);
  if (!user) {
    logSecurityEvent(
      "auth.unauthenticated",
      { method: request.method, path: new URL(request.url).pathname, ip: clientIp(request.headers) },
      "info",
    );
    throw new AppError("UNAUTHENTICATED");
  }
  return user;
}

/** Reads a JSON body. Other content types are refused, so a plain HTML form cannot post here. */
export async function readJson(request: Request): Promise<unknown> {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE");
  }
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", { message: "Request body must be JSON" });
  }
}
