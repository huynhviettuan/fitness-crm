import "server-only";
import { AppError } from "@/lib/errors/app-error";
import { can, type Permission, type Role } from "@flow/shared/permissions";
import { logSecurityEvent } from "@/lib/security/log";

/** Throws FORBIDDEN, and logs the denial (A09), when the actor's role lacks the permission. */
export function assertCan(actor: { id?: string; role: Role }, permission: Permission): void {
  if (can(actor.role, permission)) return;
  logSecurityEvent("authz.denied", { userId: actor.id ?? null, role: actor.role, permission });
  throw new AppError("FORBIDDEN");
}

/**
 * A denial decided by a domain rule rather than the role matrix, e.g. a trainer acting
 * for another trainer (A-007). Logged like assertCan's denials.
 */
export function forbidden(actor: { id?: string; role: Role }, permission: Permission, reason: string): AppError {
  logSecurityEvent("authz.denied", { userId: actor.id ?? null, role: actor.role, permission, reason });
  return new AppError("FORBIDDEN");
}
