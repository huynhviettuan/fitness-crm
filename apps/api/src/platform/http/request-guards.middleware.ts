import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { AppError } from "../errors/app-error.js";
import { appOrigin } from "../env.js";
import { clientIp, logSecurityEvent } from "../security/log.js";
import { sendError } from "./error.filter.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Runs before every /api/v1 handler (T-033, OWASP A08):
 * 1. A state-changing request must carry the app's Origin. Browsers always send it on
 *    POST/PATCH/DELETE; a request without one is refused too (fail closed).
 * 2. A body must be JSON, so a plain HTML form on another site cannot post here.
 */
export function requestGuards(request: Request, response: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(request.method)) return next();

  const origin = request.headers.origin ?? null;
  if (origin !== appOrigin) {
    logSecurityEvent("request.cross_origin_rejected", {
      method: request.method,
      path: request.path,
      origin,
      ip: clientIp(fromNodeHeaders(request.headers)),
    });
    return sendError(response, new AppError("FORBIDDEN", { message: "Cross-origin request rejected" }));
  }

  const contentType = request.headers["content-type"];
  const hasBody = Number(request.headers["content-length"] ?? 0) > 0 || request.headers["transfer-encoding"] !== undefined;
  if ((contentType !== undefined || hasBody) && !/^application\/json\b/i.test(contentType ?? "")) {
    return sendError(response, new AppError("UNSUPPORTED_MEDIA_TYPE"));
  }
  next();
}
