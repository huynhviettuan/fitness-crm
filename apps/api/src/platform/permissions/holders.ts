import type { Permission } from "@gymcrm/shared/permissions";
import type { Prisma } from "../../generated/prisma/client.js";

/**
 * Users who hold a permission as loadCurrentUser computes it (D-017): their role has it
 * and no override takes it away, or an override grants it.
 */
export function holding(permission: Permission): Prisma.UserWhereInput {
  return {
    OR: [
      { role: { permissions: { some: { permission } } }, overrides: { none: { permission, granted: false } } },
      { overrides: { some: { permission, granted: true } } },
    ],
  };
}
