/**
 * The permission tree (D-017, 09_RBAC.md): groups per module, each with its actions.
 * This catalog is code; which role holds which permission is configuration in the
 * database, edited by admin on screen. Keys are added as the features that need them
 * are built. Safe to import from client components; the API enforces permissions.
 */
export const PERMISSION_GROUPS = {
  system: ["user.manage", "role.manage", "branch.manage", "approval.manage"],
  configuration: ["config.manage"],
  history: ["audit.view", "trash.view"],
  customers: ["customer.view", "customer.manage"],
  contracts: ["contract.view", "contract.create", "contract.approve", "contract.cancel"],
  schedule: ["booking.view", "booking.manage", "session.checkIn", "session.complete"],
  employees: ["trainer.view", "trainer.manage"],
  // Deleting vouchers is its own permission (09_RBAC.md, D-035).
  cashbook: ["payment.view", "payment.record", "payment.delete", "cash.manage", "cash.delete"],
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;
export type Permission = (typeof PERMISSION_GROUPS)[PermissionGroup][number];

export const PERMISSION_KEYS = Object.values(PERMISSION_GROUPS).flat() as Permission[];

export function isPermission(value: string): value is Permission {
  return (PERMISSION_KEYS as string[]).includes(value);
}

/**
 * Data scope (D-017): per resource, a role sees ALL records in the user's branches or
 * only its OWN — the ones the user is responsible for (A-029).
 */
export const DATA_SCOPE_RESOURCES = ["customers", "contracts", "schedule", "vouchers"] as const;
export type DataScopeResource = (typeof DATA_SCOPE_RESOURCES)[number];
export const DATA_SCOPES = ["ALL", "OWN"] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

/** Fields a role can have hidden on every screen and in every export (D-017). */
export const MASKABLE_FIELDS = ["customer.phone", "customer.email", "receipts.totals"] as const;
export type MaskableField = (typeof MASKABLE_FIELDS)[number];
