import type { Permission } from "@flow/shared/permissions";

/**
 * Whether the signed-in user may do something, from the permissions the API sent with
 * the user (docs/07 `GET /me`). Only for showing or hiding UI: the API authorizes every
 * request itself (T-046).
 */
export function can(user: { permissions: readonly string[] }, permission: Permission): boolean {
  return user.permissions.includes(permission);
}
