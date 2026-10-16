import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";

// Sent on every API response (OWASP A02). Responses that reach browsers through the web
// app get the same headers from it; these cover direct clients.
const HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  // API responses are per user; never let a shared cache keep them.
  "Cache-Control": "no-store",
  ...(env.NODE_ENV === "production" ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains" } : {}),
};

export function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.set(HEADERS);
  next();
}
