// Security event log (OWASP A09). One JSON line per event on stdout/stderr, which
// Vercel collects. Never pass passwords, tokens, cookies, or password hashes.

type Level = "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level | "debug", number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type SecurityEvent =
  | "auth.sign_in.succeeded"
  | "auth.sign_in.failed"
  | "auth.unauthenticated"
  | "authz.denied"
  | "request.cross_origin_rejected";

export function logSecurityEvent(event: SecurityEvent, fields: Record<string, unknown>, level: Level = "warn"): void {
  const minimum = (process.env.LOG_LEVEL as keyof typeof LEVEL_ORDER) ?? "info";
  if (LEVEL_ORDER[level] < (LEVEL_ORDER[minimum] ?? LEVEL_ORDER.info)) return;

  const line = JSON.stringify({ time: new Date().toISOString(), level, type: "security", event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

/** The client IP as resolved by the platform (Vercel sets a single-value X-Forwarded-For). */
export function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}
