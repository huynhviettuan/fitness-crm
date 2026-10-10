import type { Permission } from "@flow/shared/permissions";
import type { Actor } from "../auth/actor.js";
import { AppError } from "../errors/app-error.js";
import { logSecurityEvent } from "../security/log.js";

type Who = Pick<Actor, "id" | "roleId" | "permissions">;

/** Throws FORBIDDEN, and logs the denial (A09), when the actor lacks the permission (T-046). */
export function assertCan(actor: Who, permission: Permission): void {
  if (actor.permissions.has(permission)) return;
  logSecurityEvent("authz.denied", { userId: actor.id, roleId: actor.roleId, permission });
  throw new AppError("FORBIDDEN");
}

/** Like assertCan, when any one of several permissions is enough. */
export function assertCanAny(actor: Who, permissions: readonly Permission[]): void {
  if (permissions.some((permission) => actor.permissions.has(permission))) return;
  logSecurityEvent("authz.denied", { userId: actor.id, roleId: actor.roleId, permission: permissions.join(" | ") });
  throw new AppError("FORBIDDEN");
}

/**
 * A denial decided by data scope or a domain rule rather than the permission itself,
 * e.g. a PT with "own" schedule booking for another trainer. Logged like assertCan's.
 */
export function forbidden(actor: Who, permission: Permission, reason: string): AppError {
  logSecurityEvent("authz.denied", { userId: actor.id, roleId: actor.roleId, permission, reason });
  return new AppError("FORBIDDEN");
}
