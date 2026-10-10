# 09 — Roles & Permissions

## Roles

### ADMIN
Full system access, including users/roles and configuration.

### MANAGER
Operational and reporting access, but not necessarily system-level security configuration.

### RECEPTIONIST
Customer, contract lookup, booking, check-in, and payment recording.

### TRAINER
View own bookings, customer/session context, and complete eligible sessions.

### ACCOUNTANT
Payments, debt, cash transactions, and finance reports.

## Permission matrix

| Capability | Admin | Manager | Receptionist | Trainer | Accountant |
|---|:---:|:---:|:---:|:---:|:---:|
| View customers | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/update customer | ✓ | ✓ | ✓ |  |  |
| Create contract | ✓ | ✓ | ✓ |  |  |
| View contracts | ✓ | ✓ | ✓ | ✓ | ✓ |
| View bookings | ✓ | ✓ | ✓ | own | ✓ |
| Create/reschedule booking | ✓ | ✓ | ✓ | limited |  |
| Cancel booking, mark no-show | ✓ | ✓ | ✓ | limited |  |
| Manual check-in | ✓ | ✓ | ✓ | ✓ |  |
| Complete session | ✓ | ✓ | limited | ✓ |  |
| View payments and debt | ✓ | ✓ | ✓ |  | ✓ |
| Record payment | ✓ | ✓ | ✓ |  | ✓ |
| Void payment | ✓ | ✓ |  |  | ✓ |
| Record income/expense | ✓ | ✓ |  |  | ✓ |
| View and void income/expense | ✓ | ✓ |  |  | ✓ |
| View reports | ✓ | ✓ | limited | own | ✓ |
| Manage trainers | ✓ | ✓ |  |  |  |
| Manage users/roles | ✓ |  |  |  |  |
| View audit logs | ✓ | ✓ |  |  | limited |

## Meaning of "limited" and "own"

| Cell | Meaning | Source |
|---|---|---|
| Trainer — view, create, reschedule, cancel booking, mark no-show | Only bookings assigned to the trainer's own trainer record | A-007, A-016 |
| Trainer — manual check-in, complete session | Only bookings assigned to the trainer's own trainer record | A-007 |
| Trainer — view reports (own) | Only the trainer's own bookings and sessions | A-007 |
| Trainer — view customers, view contracts | Scope is open; interim: only customers with a booking assigned to the trainer | OQ-006 |
| Edit draft contract, activate contract | Same roles as create contract: Admin, Manager, Receptionist | A-015 |
| Cancel contract | Admin and Manager only | A-015 |
| Trainer — view contracts | Same interim scope as customers: contracts of customers with a booking assigned to the trainer | OQ-006 |
| View bookings, cancel booking, mark no-show, manage trainers | Rows above; not in the original matrix | A-016 |
| View payments and debt; view and void income/expense | Rows above; not in the original matrix | A-021 |
| Receptionist — complete session | Not yet defined; denied | OQ-011, T-024 |
| Receptionist — view reports | Not yet defined; denied | OQ-011, T-024 |
| Accountant — view audit logs | Not yet defined; denied | OQ-011, T-024 |

A "limited" cell that is not defined here is implemented as denied (T-024).

## Implementation rules

- Each user has exactly one role (T-020).
- The matrix is implemented in code under `src/lib/permissions/`.
- Role and account status are loaded from the database on every protected request. A disabled user loses access on their next request (T-017).
- A user with role `TRAINER` must be linked to a trainer record before acting on bookings (A-010).
