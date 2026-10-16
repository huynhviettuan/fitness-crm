import {
  DATA_SCOPE_RESOURCES,
  MASKABLE_FIELDS,
  isPermission,
  type DataScope,
  type DataScopeResource,
  type MaskableField,
  type Permission,
} from "@gymcrm/shared/permissions";
import type { Db } from "../db/prisma.js";
import type { AccessWindow } from "./access-hours.js";

/**
 * What a service needs to authorize, scope, and audit an action (D-014, D-017, T-046).
 * Built from the database for every request, so changes to a role, an override, or a
 * branch grant take effect at once (AC-02).
 */
export type Actor = {
  id: string;
  roleId: string;
  /** The role's permissions with this user's overrides applied. */
  permissions: ReadonlySet<Permission>;
  /** Every branch, or the granted ones (active or not: old records stay visible). */
  branches: "ALL" | readonly string[];
  scopes: Readonly<Record<DataScopeResource, DataScope>>;
  masks: ReadonlySet<MaskableField>;
  /** The employee this login belongs to (brief §8.4): their own bookings and profile under "own" scope. */
  employeeId: string | null;
};

/** The signed-in user: the actor plus what the screens show about them. */
export type CurrentUser = Actor & {
  name: string;
  email: string;
  locale: "vi" | "en";
  role: { id: string; name: string };
  allBranches: boolean;
  status: "ACTIVE" | "DISABLED";
  accessWindows: AccessWindow[];
};

/** Loads a user with everything that decides what they may do, or null if unknown. */
export async function loadCurrentUser(db: Db, userId: string): Promise<CurrentUser | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      locale: true,
      status: true,
      allBranches: true,
      role: {
        select: {
          id: true,
          name: true,
          permissions: { select: { permission: true } },
          dataScopes: { select: { resource: true, scope: true } },
          fieldMasks: { select: { field: true } },
        },
      },
      overrides: { select: { permission: true, granted: true } },
      branches: { select: { branchId: true } },
      accessWindows: { select: { weekdays: true, startTime: true, endTime: true } },
      employee: { select: { id: true } },
    },
  });
  if (!user) return null;

  const permissions = new Set(user.role.permissions.map((p) => p.permission).filter(isPermission));
  for (const { permission, granted } of user.overrides) {
    if (!isPermission(permission)) continue;
    if (granted) permissions.add(permission);
    else permissions.delete(permission);
  }

  const scopeRows = new Map(user.role.dataScopes.map((row) => [row.resource, row.scope]));
  // A resource without a row is OWN: closed until admin opens it (schema.prisma).
  const scopes = Object.fromEntries(
    DATA_SCOPE_RESOURCES.map((resource) => [resource, scopeRows.get(resource) ?? "OWN"]),
  ) as Record<DataScopeResource, DataScope>;
  const masks = new Set(
    user.role.fieldMasks
      .map((m) => m.field)
      .filter((field): field is MaskableField => (MASKABLE_FIELDS as readonly string[]).includes(field)),
  );

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    locale: user.locale,
    status: user.status,
    role: { id: user.role.id, name: user.role.name },
    roleId: user.role.id,
    allBranches: user.allBranches,
    permissions,
    branches: user.allBranches ? "ALL" : user.branches.map((b) => b.branchId),
    scopes,
    masks,
    employeeId: user.employee?.id ?? null,
    accessWindows: user.accessWindows,
  };
}
