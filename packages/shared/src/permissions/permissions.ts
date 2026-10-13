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
  // Leads and consulting (brief §4.1): seeing, adding, and working leads; reassigning them
  // (managers); and receiving new leads round-robin (consultants, BR-203); merging two records of one person (managers, A-065);
  // managing the script library (managers, A-072); the automatic consulting audit (managers, A-084); and
  // removing a wrong tick of a consulting step (Admin only, D-054).
  leads: [
    "lead.view",
    "lead.create",
    "lead.manage",
    "lead.assign",
    "lead.receive",
    "lead.merge",
    "script.manage",
    "lead.audit",
    "lead.untick",
  ],
  customers: ["customer.view", "customer.manage"],
  // Services and their price tiers (brief §5.1, D-021): everyone who sells reads them, only Admin edits them.
  services: ["service.view", "service.manage"],
  // Promotions and vouchers (brief §5.1, A-110): Admin creates them; selling staff see those on offer through service.view.
  promotions: ["promotion.manage"],
  // Unapproving and deleting a contract are Admin's (brief §5.3, A-124, A-125).
  contracts: [
    "contract.view",
    "contract.create",
    "contract.approve",
    "contract.cancel",
    "contract.unapprove",
    "contract.delete",
  ],
  schedule: ["booking.view", "booking.manage", "session.checkIn", "session.complete"],
  // Employee profiles and working schedules (brief §8.4).
  employees: ["employee.view", "employee.manage"],
  // Giao việc (brief §8.2): every default role works and assigns tasks (09_RBAC.md).
  tasks: ["task.view", "task.create"],
  // Export to Excel, one per list (brief §2, A-077): needed in addition to seeing the list.
  exports: [
    "user.export",
    "customer.export",
    "lead.export",
    "contract.export",
    "payment.export",
    "cash.export",
    "task.export",
    "audit.export",
    "trash.export",
  ],
  // Reports (brief §9, D-041, A-093): each report and its export is its own permission.
  reports: ["report.consulting", "report.consultingExport", "report.leadAnalysis", "report.leadAnalysisExport"],
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
export const DATA_SCOPE_RESOURCES = [
  "leads",
  "customers",
  "contracts",
  "schedule",
  "vouchers",
  "staff",
  "tasks",
] as const;
export type DataScopeResource = (typeof DATA_SCOPE_RESOURCES)[number];
export const DATA_SCOPES = ["ALL", "OWN"] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

/** Fields a role can have hidden on every screen and in every export (D-017). */
// ID documents and health notes are sensitive personal data (D-042).
export const MASKABLE_FIELDS = [
  "customer.phone",
  "customer.email",
  // The address and the emergency contact together (A-069).
  "customer.address",
  "customer.idDocument",
  "customer.health",
  "receipts.totals",
] as const;
export type MaskableField = (typeof MASKABLE_FIELDS)[number];
