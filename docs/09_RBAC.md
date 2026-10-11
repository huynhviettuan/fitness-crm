# 09 — Roles, Permissions & Approvals

Model from brief §2 (D-017, D-018, T-046). Everything on this page is **initial configuration**: admin changes it on screen, and changes take effect immediately.

## Model

| Element | Meaning |
|---|---|
| Role | A named set of permissions; admin creates, edits, and clones roles. |
| Permission tree | Groups per module, each with actions: view, create, edit, delete, approve, export. Groups: Catalogs, System, Leads and consulting, Customers, Contract operations, PT and class schedule, Workout plans, Tasks, Cash book, Employees, Reports. |
| Individual overrides | A user inherits the role and can have single permissions switched on or off, so no role is named after a person. |
| Data scope | Separate from functions: **all** or **only mine** for leads, members, contracts, PT schedule, receipts and expenses, staff, action history. Plus: see staff of all branches, see contract totals, see member debt. |
| Field masking | Hide member phone, email, address, ID documents, and receipt list totals per role — on every screen and in every export. |
| Sensitive actions | Separate permissions: Đã tập, Burn Show, delete session, delete contract, delete receipt, edit receipt date, deactivate and reactivate contract, approve exception price, view trash, export Excel. |
| Reports | Each report and dashboard is its own permission. |
| Branches | Accounts are granted branches; the system is multi-branch from day one. |
| Access hours | Allowed days and times to sign in, per account. |
| Login history | Time, device, and IP of each sign-in. |

**Rules:**

- A menu or button without permission is hidden.
- The API checks the permission, branch, data scope, and masking on every request (T-046).
- Every change to roles, permissions, scopes, masks, thresholds, or the approval matrix is audited (T-048).

## Default roles

| Role | Does | Data scope |
|---|---|---|
| Admin | Full configuration, Đã tập check-in, deletions, trash, every report | All branches |
| Fitness Manager | Receives new leads and escalations, reassigns leads, audits consulting, approves contracts and exception prices, receives "Báo Studio" tasks | Assigned branches |
| Master | Views and reviews every PT's plans, handles escalations, workout dashboard | Assigned branches |
| Consulting | Works assigned leads through the journey, creates contracts for approval | Own leads and customers |
| PT | Books sessions, writes plans, logs sessions, own session report | Own customers and schedule |
| Receptionist | Walk-in leads, Show / No show, booking support, completes customer details | Assigned branches |
| Marketing | Lead reports by channel and source | No phone numbers or documents |

There is no default Accountant role. Cash-book work (receipts, expense vouchers, PT payouts) is granted through Cash book permissions, for example to the Fitness Manager or to a custom role. Users of the Phases 0–4 Accountant role migrate to a custom role with those permissions (`25_BRIEF_V2_GAP_ANALYSIS.md`).

## Initial permission matrix

✓ = granted · own = only own data · — = not granted

| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Configuration (option lists, parameters, status rules, services, tiers, templates) | ✓ | — | — | — | — | — | — |
| Users, roles, permissions, approval matrix | ✓ | — | — | — | — | — | — |
| Employees and PT working schedules | ✓ | ✓ | — | — | own schedule | — | — |
| Leads: create | ✓ | ✓ | — | ✓ | — | ✓ (walk-in) | — |
| Leads: view, work the checklist | ✓ | ✓ | — | own | — | ✓ | — |
| Leads: reassign | ✓ | ✓ | — | — | — | — | — |
| Show / No show | ✓ | ✓ | — | ✓ | — | ✓ | — |
| Consulting audit | ✓ | ✓ | — | — | — | — | — |
| Customers: view | ✓ | ✓ | ✓ | own | own | ✓ | — |
| Customers: edit details | ✓ | ✓ | — | own | — | ✓ | — |
| Contracts: create (pending) | ✓ | ✓ | — | ✓ | — | — | — |
| Contracts: approve, exception price | ✓ | ✓ | — | — | — | — | — |
| Contracts: deactivate / reactivate, delete | ✓ | — | — | — | — | — | — |
| Change vouchers: create | ✓ | ✓ | — | ✓ | — | — | — |
| PT schedule: book, cancel | ✓ | ✓ | — | — | own | ✓ | — |
| Đã tập, Burn Show, delete session | ✓ | — | — | — | — | — | — |
| Classes: enroll, attendance | ✓ | ✓ | — | — | own classes | ✓ | — |
| Workout plans, session logs | ✓ | ✓ | ✓ (review all) | — | own | — | — |
| Escalations: handle | ✓ | ✓ | ✓ | — | — | — | — |
| Receipts: create | ✓ | ✓ | — | ✓ | — | ✓ | — |
| Expense vouchers, PT payouts | ✓ | ✓ | — | — | — | — | — |
| Edit receipt date, delete vouchers | ✓ | — | — | — | — | — | — |
| Tasks: create and work | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Trash: view | ✓ | — | — | — | — | — | — |
| Export Excel | ✓ | ✓ | — | — | — | — | ✓ (masked) |
| Reports | all | all | workout dashboard | consulting (own) | own sessions | booking | lead analysis |

## Initial approval matrix (D-018)

| Action group | Approval | Approver |
|---|---|---|
| Create and edit contracts, exception prices | Yes | Fitness Manager; above the discount threshold, Admin |
| Change vouchers: renewal, upgrade, hold, transfer, branch transfer, conversion, cancellation | Yes | Fitness Manager |
| Receipts and expense vouchers | Yes | Fitness Manager or Admin |
| Deleting any business record; deactivating a contract | Yes | Admin |
| Editing a customer's identity (name, phone, email, documents) | Yes | Fitness Manager |
| Creating and editing workout plans and templates | Yes | Master |
| Daily operations: lead entry, consulting steps, booking and cancelling, session logs, tasks | No (audit, admin check-in, and logs) | — (OQ-029) |

Each role also has a **discount threshold**: the largest discount it may approve itself; above it, the request escalates to the next level.

- Nobody approves their own submission.
- Requests pending longer than the configured time remind the approver and notify their superior.

## Built so far (M1 slice 2, 2026-10-10)

The model above runs in the API (T-054) for the resources that exist today. Screens: **Administration → Users** (role, branches, per-user overrides, allowed hours, login history), **Roles** (permission tree, data scope, hidden fields, clone), and **Branches**.

| Group | Permission keys |
|---|---|
| System | `user.manage`, `role.manage`, `branch.manage` |
| Leads | `lead.view`, `lead.create`, `lead.manage` (edit and change status; Admin, Fitness Manager, Consulting, Receptionist; M2 slice 1), `lead.assign` (reassign, told of new leads; Admin, Fitness Manager), `lead.receive` (in the round-robin; Consulting; M2 slice 2) |
| Customers | `customer.view`, `customer.manage` |
| Contract operations | `contract.view`, `contract.create`, `contract.approve`, `contract.cancel` |
| PT schedule | `booking.view`, `booking.manage`, `session.checkIn`, `session.complete` |
| Employees | `employee.view`, `employee.manage` (profiles and working schedules, M1 slice 6; were `trainer.*`) |
| Cash book | `payment.view`, `payment.record`, `payment.delete`, `cash.manage`, `cash.delete` |
| Configuration | `config.manage` (option lists and system parameters; Admin only, M1 slice 3) |
| History | `audit.view` (action history), `trash.view` (Admin only, M1 slice 4) |
| Tasks | `task.view` (see and work on tasks), `task.create` (give tasks); every role (M1 slice 7) |
| System | `approval.manage`: the approval matrix (Admin, M1 slice 5). Deciding a request needs no permission of its own: the matrix names the approver roles (D-018) |

Data-scope resources: leads (*only mine*: added by me or in my charge, T-061), customers, contracts, schedule, vouchers (*only mine* per A-029), staff (*only mine*: one's own employee profile and schedule, T-058), tasks (*only mine*: tasks one gave, got, or that went to one's department; Admin and Fitness Manager see all, T-060). Hideable fields: customer phone, customer email, receipt totals.

Seeded roles (initial configuration, editable): Admin (everything), Fitness Manager (everything except deleting vouchers, the trash and history, and the System group), Master (view only), Consulting (*only mine*; customers, contract create, receipts), PT (*only mine*; schedule and session actions), Receptionist (customers, schedule, check-in, receipts; no contract create), Marketing (no permissions; phone and email hidden), and the custom role "Kế toán" migrated from the old Accountant (A-032). The rest of the tree (leads, approvals, status rules and other configuration, trash, reports, sensitive session actions) is added by the milestone that builds each module.

## Status of the first brief's model

The five fixed roles (Admin, Manager, Receptionist, Trainer, Accountant), the code matrix, and the "limited" cells (T-020, T-024, A-007, A-015, A-016, A-021) are superseded by this page and were removed from the code in M1 slice 2 (A-032).
