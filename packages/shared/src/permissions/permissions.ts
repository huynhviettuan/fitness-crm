export const ROLES = ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER", "ACCOUNTANT"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Permission matrix from docs/09_RBAC.md (T-020). Capabilities are added as the
 * phase that needs them is built. A "limited" cell that is not yet defined is
 * denied (T-024); scoping rules (e.g. a trainer's own bookings) live in services.
 * Safe to import from client components; the API enforces it with `assertCan`.
 */
const PERMISSIONS = {
  "customer.view": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER", "ACCOUNTANT"],
  "customer.manage": ["ADMIN", "MANAGER", "RECEPTIONIST"],
  "contract.view": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER", "ACCOUNTANT"],
  // Create (docs/09), edit drafts, and activate. A-015.
  "contract.manage": ["ADMIN", "MANAGER", "RECEPTIONIST"],
  // Cancelling cascades to bookings (D-010). A-015.
  "contract.cancel": ["ADMIN", "MANAGER"],
  // Read-only, so the accountant can see a contract's session history. A-016.
  "booking.view": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER", "ACCOUNTANT"],
  // Create and reschedule (docs/09); cancel and no-show use the same roles (A-016).
  // A trainer only for their own bookings (A-007).
  "booking.manage": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER"],
  "session.checkIn": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER"],
  // Receptionist is "limited" and not yet defined (OQ-011), so denied (T-024).
  "session.complete": ["ADMIN", "MANAGER", "TRAINER"],
  "trainer.view": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER", "ACCOUNTANT"],
  // Trainer records and their login link (A-010, A-016).
  "trainer.manage": ["ADMIN", "MANAGER"],
  // Payment history and the debt list: the roles that record payments (A-021).
  "payment.view": ["ADMIN", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"],
  "payment.record": ["ADMIN", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"],
  "payment.void": ["ADMIN", "MANAGER", "ACCOUNTANT"],
  // Record income/expense (docs/09); viewing and voiding use the same roles (A-009, A-021).
  "cash.manage": ["ADMIN", "MANAGER", "ACCOUNTANT"],
  "user.manage": ["ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

