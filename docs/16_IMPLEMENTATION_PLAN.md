# 16 — Implementation Plan

## Phase 0 — Foundation

**Status: built 2026-10-09.** Open items: CI has not run yet (no Git/GitHub repository), and the Vercel project and preview deployment are not set up.

Deliverables:

- single Next.js full-stack application
- TypeScript strict mode
- Tailwind CSS + shadcn/ui baseline with the design tokens from `23_UI_DESIGN_SYSTEM.md` (T-025)
- Inter font with the Vietnamese subset
- `next-intl` with `vi` and `en` message files (T-027)
- app shell: sidebar, top bar, global search placeholder, user menu with language switch
- `Money` and `DateTime` formatters; the other shared components from `23_UI_DESIGN_SYSTEM.md` §8 are built by the first feature that needs them, as the one shared version
- PostgreSQL + Prisma
- centralized Prisma/database module
- environment handling, including `GYM_TIMEZONE` (A-001)
- Zod validation baseline
- lint/type-check setup
- Vitest unit tests, and integration tests against a real PostgreSQL database locally and in CI (T-021)
- Playwright setup: one composition root (`e2e/fixtures.ts`), page objects, one saved session per role, test data removed in fixture teardown
- authentication skeleton
- Vercel project configuration

Exit criteria:

- app runs locally
- production build succeeds
- initial DB migration works
- protected server route/action works
- CI validation passes
- preview deployment can be created without accessing production DB

## Phase 1 — Identity & Customer

**Status: built 2026-10-09.**

Deliverables:

- users with one fixed role and an `ACTIVE`/`DISABLED` status (T-020)
- login/logout/current-user flow
- server-side authorization helpers that reload the user on every request (T-017), covered by INT-006
- permission matrix in `src/lib/permissions/`, with undefined "limited" cells denied (T-024)
- audit writer, used from the first audited change (T-022)
- user management screen: create user, change role, reset password, disable/enable (FR-ADM-001)
- customer CRUD/search, with sequence-generated customer codes (T-019) and accent-insensitive name search
- customer detail shell
- E2E: login, E2E-001 part 1 (create and find a customer), E2E-009 part 1 (trainer cannot manage users)

## Phase 2 — Contract

**Status: built 2026-10-10.** Completed sessions and payments show 0 until Phases 3 and 4 add bookings and payments. Open: OQ-013, OQ-014, OQ-015.

Deliverables:

- contract creation/detail
- total/completed/remaining session calculation
- contract value
- basic status lifecycle, with `EXPIRED` derived (T-018), covered by INT-008
- idempotency key on contract create (T-015)
- opening balance columns, counted in remaining sessions and paid amount (D-011); the import tool waits for OQ-014
- contract cancellation; the cascade to bookings (D-010) was added in Phase 3 (A-018)
- contract history/audit behavior required by V1

## Phase 3 — Booking & Session

**Status: built 2026-10-10.** The interim rules of OQ-001, OQ-002, OQ-005, OQ-008, OQ-010, and OQ-012 are in place. New decisions T-036 to T-038 and assumptions A-016 to A-019.

Deliverables:

- trainer management, including the trainer ↔ user link (A-010)
- booking calendar/list
- trainer overlap validation, backed by the database exclusion constraint (T-014)
- manual check-in
- complete session, using the locked transaction in `22_TECHNICAL_ARCHITECTURE.md` §7
- no-show/cancel
- idempotent session consumption
- concurrency integration tests INT-001 to INT-003 and INT-007

This is the most business-critical phase.

## Phase 4 — Finance

**Status: built 2026-10-10.** The interim rules of OQ-003 and OQ-007 are in place, and OQ-013's interim now also refuses payments on cancelled contracts. New decisions T-039 and T-040, assumptions A-020 to A-022, open question OQ-016.

Deliverables:

- contract payments, with idempotency keys (T-015)
- payment void with reason (A-008)
- paid/debt calculation
- cash income/expense, with void-and-re-record correction (A-009)
- financial authorization
- audit events
- duplicate-submission integration tests INT-004 and INT-005

## Phase 5 — Dashboard & Reports

Deliverables:

- dashboard KPIs
- session report
- trainer report
- contract/debt report
- finance report
- audit log viewer (FR-AUD-001)

Build it in four slices. Each slice ships its service, page, permissions, tests (unit, integration, E2E, security), and docs, so stopping between slices leaves nothing half done.

| Slice | Scope | Notes |
|---|---|---|
| 1. Dashboard KPIs | FR-DASH-001 to FR-DASH-004; the KPI list in `10_REPORTING_DASHBOARD.md` | Start `src/modules/reporting/` with one query per figure; the reports in slices 2–3 reuse them (doc 10 "Data consistency"). Net cash flow waits for OQ-007. "Contracts ending soon" goes by remaining sessions (D-012, A-023). |
| 2. Session and trainer reports | Reports 1 and 2 | Date range in gym days (A-001), trainer filter. A trainer sees only their own (A-007). |
| 3. Contract/debt and finance reports | Reports 3 and 4 | Period figures exclude opening balances (D-011). Payments and cash income stay separate lines (OQ-007 interim). |
| 4. Audit log viewer | FR-AUD-001 | Admin and Manager; the Accountant's "limited" access is denied until OQ-011 (T-024). Filters: entity, actor, day range. |

Report access follows `09_RBAC.md` "View reports": the Receptionist's "limited" cell is denied until OQ-011 is answered.

## Phase 6 — Hardening & Release

Deliverables:

- RBAC review
- full E2E suite run against a production-like environment (each phase ships its own E2E tests)
- security testing layer 2 (OWASP ZAP scan) and layer 3 (manual ASVS pentest), see `24_SECURITY_TESTING.md`; layer 1 runs in CI from Phase 1 onward and every phase extends it for its own routes
- decisions TS-004 (admin MFA) and TS-005 (account lockout), and security log alerting
- duplicate-submit/concurrency review
- error handling
- audit review
- Vercel production deployment
- PostgreSQL backup/restore verification
- UAT

## Open questions gating each phase

Build the interim behavior from `18_DECISIONS_ASSUMPTIONS.md` and leave the blocked part unbuilt until the question is answered.

| Phase | Open questions |
|---|---|
| Phase 1 — Identity & Customer | OQ-006, OQ-011 |
| Phase 2 — Contract | OQ-013 (OQ-004 answered: D-010) |
| Phase 3 — Booking & Session | OQ-001, OQ-002, OQ-005, OQ-008, OQ-010, OQ-012 |
| Phase 4 — Finance | OQ-003, OQ-007 |
| Phase 5 — Dashboard & Reports | OQ-007, OQ-011 |
| Phase 6 — Hardening & Release | OQ-014 (import details, before any production data is loaded; OQ-009 answered: D-011) |

## Suggested AI-agent work units

Do not ask the agent to build a whole phase at once. Split by vertical slice, for example:

```text
Task: Complete Session
- Zod input contract
- Route Handler or Server Action boundary
- authorization
- SessionService transaction with contract row lock (T-013)
- SessionRepository/database changes
- remaining-session validation inside the locked transaction
- idempotency, including concurrent requests
- audit event
- unit/integration test, including INT-001 and INT-002
- UI action
- E2E happy path + retry path
```

## Architectural rule for all phases

New features should follow:

```text
UI
  -> Server Action / Route Handler
      -> Application/Domain Service
          -> Repository
              -> Prisma/PostgreSQL
```

Do not bypass the service layer for business-critical writes.
