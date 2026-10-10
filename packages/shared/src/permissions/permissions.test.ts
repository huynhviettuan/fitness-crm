import { describe, expect, it } from "vitest";
import { ROLES, can, type Permission, type Role } from "./permissions.js";

// Expected values come from docs/09_RBAC.md.
const MATRIX: Record<Permission, Role[]> = {
  "customer.view": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER", "ACCOUNTANT"],
  "customer.manage": ["ADMIN", "MANAGER", "RECEPTIONIST"],
  "contract.view": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER", "ACCOUNTANT"],
  "contract.manage": ["ADMIN", "MANAGER", "RECEPTIONIST"],
  "contract.cancel": ["ADMIN", "MANAGER"],
  "booking.view": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER", "ACCOUNTANT"],
  "booking.manage": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER"],
  "session.checkIn": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER"],
  "session.complete": ["ADMIN", "MANAGER", "TRAINER"],
  "trainer.view": ["ADMIN", "MANAGER", "RECEPTIONIST", "TRAINER", "ACCOUNTANT"],
  "trainer.manage": ["ADMIN", "MANAGER"],
  "payment.view": ["ADMIN", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"],
  "payment.record": ["ADMIN", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"],
  "payment.void": ["ADMIN", "MANAGER", "ACCOUNTANT"],
  "cash.manage": ["ADMIN", "MANAGER", "ACCOUNTANT"],
  "user.manage": ["ADMIN"],
};

describe("permission matrix (docs/09)", () => {
  for (const [permission, allowed] of Object.entries(MATRIX) as [Permission, Role[]][]) {
    for (const role of ROLES) {
      const expected = allowed.includes(role);
      it(`${role} ${expected ? "can" : "cannot"} ${permission}`, () => {
        expect(can(role, permission)).toBe(expected);
      });
    }
  }
});
