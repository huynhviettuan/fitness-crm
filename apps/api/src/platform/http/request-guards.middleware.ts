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
 * 2. A body must be JSON, so a plain HTML form on another site cannot post here. The one exception is the upload
 *    of a picture (M4.1b), whose body is the picture itself with an image type; a form cannot send that type, and
 *    the Origin check above still applies.
 */
export function requestGuards(request: Request, response: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(request.method)) return next();

  const origin = request.headers.origin ?? null;
  // A check-in machine is not a browser and sends no Origin; it proves itself with its device key, which its guard
  // checks (D-072). Only that one route is open this way.
  const isMachine =
    request.method === "POST" &&
    /\/checkin\/scans\/?$/.test(request.originalUrl.split("?")[0] ?? "") &&
    typeof request.headers["x-device-key"] === "string";
  // A lead source (the website form, M10.1; forwarded email, M10.5) is not a browser either: it proves itself with its intake
  // key, in a header or as the Basic password.
  const isSource =
    request.method === "POST" &&
    /\/intake\/(website|email)\/?$/.test(request.originalUrl.split("?")[0] ?? "") &&
    (typeof request.headers["x-intake-key"] === "string" || /^Basic /.test(request.headers.authorization ?? ""));
  // WhatsApp (M10.2), Messenger and Instagram (M10.3) post from Meta's servers, and Zalo (M10.6) from its own, which send no Origin; its signature over the body is the proof, checked in the
  // service before anything is read. Only that route is open this way.
  const isWebhook =
    request.method === "POST" &&
    /\/intake\/(whatsapp|meta|zalo)\/[0-9a-f-]{36}\/?$/i.test(request.originalUrl.split("?")[0] ?? "") &&
    (typeof request.headers["x-hub-signature-256"] === "string" ||
      typeof request.headers["x-zevent-signature"] === "string");
  if (origin !== appOrigin && !isMachine && !isSource && !isWebhook) {
    logSecurityEvent("request.cross_origin_rejected", {
      method: request.method,
      path: request.path,
      origin,
      ip: clientIp(fromNodeHeaders(request.headers)),
    });
    return sendError(response, new AppError("FORBIDDEN", { message: "Cross-origin request rejected" }));
  }

  const contentType = request.headers["content-type"];
  const hasBody =
    Number(request.headers["content-length"] ?? 0) > 0 || request.headers["transfer-encoding"] !== undefined;
  const isPictureUpload =
    request.method === "POST" &&
    /\/files\/?$/.test(request.originalUrl.split("?")[0] ?? "") &&
    /^image\/(png|jpeg|webp)$/i.test(contentType ?? "");
  if ((contentType !== undefined || hasBody) && !isPictureUpload && !/^application\/json\b/i.test(contentType ?? "")) {
    return sendError(response, new AppError("UNSUPPORTED_MEDIA_TYPE"));
  }
  next();
}
