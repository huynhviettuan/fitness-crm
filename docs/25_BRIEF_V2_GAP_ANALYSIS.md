# 25 — Brief v2 Gap Analysis

Phases 0–4 were built from the first brief (customers, contracts, PT bookings and sessions, payments, income/expense, one gym, five fixed roles, one Next.js app). Brief v2 (`docs/source/BRIEF_V2_vi.md`) replaces that brief. This document compares what exists with what brief v2 requires, says what is reused and what is reworked, and assigns each item to a milestone of `16_IMPLEMENTATION_PLAN.md` (M1–M11).

Status legend: **Built** (meets brief v2) · **Partly** (exists, needs changes) · **Conflicts** (exists, behaves differently from brief v2) · **New** (nothing yet).

## Summary

| Area | Status | Milestone |
|---|---|---|
| Architecture (one Next.js app → `apps/web` + `apps/api` NestJS, T-041) | Built (M1 slice 1, 2026-10-10) | M1 |
| Users, roles, permissions (5 fixed roles → permission tree, data scope, masking, branches, login hours, history) | Built (M1 slice 2) for existing resources | M1 |
| Branches (one gym → multi-branch) | Built (M1 slice 2) | M1 |
| Approval engine and approval matrix (D-018) | Built (M1 slice 5); contracts, exception prices, change vouchers, and workout plans join in M4, M7, M8 | M1 |
| Option lists with "Khác", system parameters, status rules (D-015, D-016, T-049) | Built (M1 slice 3) except status rules (M5) | M1 |
| Audit log (exists for critical actions → before/after for everything, T-048) | Built (M1 slice 4) | M1 |
| Trash and soft delete (D-035) | Built (M1 slice 4) for receipts and cash entries; other records join as their modules are built | M1 |
| Employees, PT working schedules | Built (M1 slice 6, T-058); ID documents in M2 (A-041); calendar rows per PT and week view in M5 | M1 |
| In-app notifications and Tasks (D-037) | New | M1 |
| Leads, consulting journey, re-care, scripts (D-019, D-020) | New | M2 |
| Consulting audit and dashboard (D-045) | New | M3 |
| Customers (simple profile → full profile from lead, derived status) | Partly | M2, M4 |
| Services and price tiers, promotions, vouchers (D-021) | New | M4 |
| Contracts (draft/activate/cancel → pending approval, locked, exception price, splits, delete, freeze) | Conflicts | M4 |
| Payments and cash (payments + void, separate cash → receipts, expense vouchers, cash book, trash) | Conflicts | M4 |
| PT schedule and sessions (check-in → complete; no-show free → configurable statuses, admin "Đã tập", Burn Show, delete with refund) | Conflicts | M5 |
| Class schedule and attendance | New | M5 |
| PT revenue allocation and payouts (D-032) | New | M5 |
| Customer email (D-036) | New | M6 |
| Workout plans and logs, escalation (D-033) | New | M7 |
| Contract change vouchers (D-024) | New | M8 |
| Reports and dashboards (D-041) | New | M3, M5, M7, M9 |
| GymMaster and consulting-Excel import (D-039) | New | M9 |
| Lead channel APIs (D-044) | New | M10 |
| AI-assisted audit | New | M11 |

## What Phases 0–4 give us to reuse

| Asset | Where today | Reuse in brief v2 |
|---|---|---|
| Domain services, repositories, Zod schemas (customers, contracts, bookings, sessions, payments, cash) | `src/modules/*` | Move to `apps/api` as NestJS providers. The service/repository split, `Actor` pattern, and error codes carry over. |
| Locked transactions (contract → booking lock order), idempotency keys with replay, exclusion constraint for trainer overlap | `booking.repository.ts`, `contract.service.ts`, `payment.service.ts`, migration `20261010013008_bookings` | Keep as is (T-013, T-014, T-015, T-036, T-040); add the customer-overlap constraint and status-rule flags (T-050). |
| Prisma schema and migrations | `prisma/` | Becomes the starting schema in `apps/api`; new migrations add branches, permissions, leads, etc. Existing tables are migrated, not recreated. |
| Better Auth, security headers, Origin check, rate limit, security event log | `src/lib/auth`, `src/proxy.ts`, `src/lib/api` | Auth moves into the API (T-044); CSP and headers stay in the web app; Origin check and logging move to API middleware. |
| UI design system: shadcn/ui, tokens, `DataTable`, `StatusBadge`, `ConfirmDialog`, `Money`, `DateTime`, forms, i18n vi/en | `src/components`, `messages/` | Moves to `apps/web` unchanged; extended with the shared list template, drop-down + "Khác" field, Kanban, and configurable status colors. |
| PT calendar grid (`TrainerScheduleGrid`) | `src/app/(crm)/calendar` | Reused, turned to trainers as rows, with week view, working-schedule shading, and configurable colors. |
| Test suites: unit, integration against Postgres, Playwright with page objects and teardown, OWASP security tests, Server Action guard | `tests/`, `e2e/`, `src/**/*.test.ts` | Integration tests move with the services; E2E stays against the web app; the security suite targets the API; the Server Action guard becomes an API-endpoint permission guard test. |
| Demo seed, CI workflow, dependency audit gate | `prisma/seed-demo.ts`, `.github/` | Adapted to the monorepo (pnpm, Turborepo). |

## Conflicts that need rework

| Built behavior | Brief v2 | Rework | Milestone |
|---|---|---|---|
| Fixed roles enum (ADMIN, MANAGER, RECEPTIONIST, TRAINER, ACCOUNTANT) and a code permission matrix | Configurable roles, permission tree, overrides, data scope, masking (D-017) | Replace `UserRole` with role/permission tables; seed the 7 default roles; map old users (Manager → Fitness Manager, Receptionist → Receptionist, Trainer → PT, Accountant → a custom "Accountant" role kept for cash-book work). | M1 |
| One gym; no `branch_id` | Every business record has a branch (D-014) | Add `branches` and `branch_id` to every business table; backfill with one default branch. | M1 |
| Customer status ACTIVE/INACTIVE set by hand | Derived from contracts (D-040) | Drop the stored status from use; compute it. | M4 |
| Customers created directly | Lead → Show → Customer, one record (D-019) | A lead table (or a person table with a stage) that keeps the same ID; existing customers become people at stage Customer. | M2 |
| Contract DRAFT → ACTIVE → CANCELLED; drafts editable; free contract value | Pending approval → approved (locked); price from tiers; exception price; statuses incl. Frozen and On hold; delete to trash (D-021–D-023) | New contract model and screens; existing contracts migrate as approved, with their value as an exception price flagged "imported". | M4 |
| Contract cancel cascades to bookings (D-010) | Cancellation is a change voucher with fee and refund (D-024) | Rework cancel into the change-voucher flow; keep the cascade (OQ-030 interim). | M8 (M4 keeps the current cancel until then) |
| Booking BOOKED → CHECKED_IN → COMPLETED; no-show and cancel consume nothing | Booked, Đã tập, Hủy lịch, no-show, deleted; no-show consumes and credits the PT; rules configurable (D-025, D-026, T-050) | Replace the booking status enum with configurable statuses; store consume/credit flags per session; remove the separate check-in; "Đã tập" admin-only and locked; add delete-with-refund and Burn Show. | M5 |
| Trainer overlap only | Trainer and customer overlap; PT working schedules (D-030) | Working schedules, the booking check, and grid shading done in M1 slice 6 (T-058); customer overlap remains. | M5 |
| Trainers as a separate table with an optional login | Employees with accounts; PTs are employees (brief §8.4) | Done in M1 slice 6: trainers became employees in place, codes kept (T-058). | M1 |
| Payments CONFIRMED/VOIDED with void reason | Receipts with approval, deleted to trash; receipt date edit permission (D-034, D-035) | Payments become receipts; voided payments migrate as deleted receipts with their reason. | M4 |
| Cash transactions INCOME/EXPENSE; payments reported separately (OQ-007 interim) | Cash book with receipts and expense vouchers, balances per method and branch (D-034) | Income entries become receipts without a contract; expenses become expense vouchers; cash-book report. | M4 |
| Fixed code prefixes KH/HD/PT | Configurable prefixes, legacy codes kept (D-038) | Prefix settings; import keeps old codes. | M1, M9 |
| Free-text categories and reasons | Drop-downs with "Khác" (D-016) | Option-list tables; migrate existing free text as "Khác" entries. | M1, then each module |
| Email: none | Customer email on every session-count change (D-036) | Outbox, provider, templates. | M6 |
| Server Actions and Route Handlers in Next.js | API in NestJS; web calls it (T-041, T-043) | Done in M1 slice 1: Route Handlers became controllers; Server Actions are thin calls to the API; browsers reach the API through the web app (T-053) | M1 |

## Brief section coverage

| Brief | Topic | Docs | Milestone |
|---|---|---|---|
| §1 | Scope, principles (fixed flow, configurable values, drop-downs) | 00, 01, 18 (D-013, D-015, D-016) | M1 |
| §2 | Users, roles, permissions, approvals | 09, 18 (D-017, D-018) | M1 |
| §3 | Customer journey, lead statuses | 02, 05, 18 (D-019, D-020) | M2 |
| §4.1 | Leads, consulting checklist, scripts, audit | 02, 06 (FR-LEAD), 08, 18 (D-020, D-044, D-045) | M2, M3 |
| §4.2 | Customers | 06 (FR-CUS), 08, 18 (D-040) | M2, M4 |
| §5 | Services, tiers, contracts, approval, lock, delete, freeze, change vouchers | 02, 05, 06 (FR-SVC, FR-CON, FR-CHG), 18 (D-021–D-024) | M4, M8 |
| §6 | PT grid, statuses, deletion, Burn Show, classes, PT revenue | 02, 05, 06 (FR-PT, FR-CLS), 10, 18 (D-025–D-032) | M5 |
| §7 | Workout catalogs, plans, logs, escalation, progress | 06 (FR-WKO), 08, 18 (D-033) | M7 |
| §8.1 | Cash book | 06 (FR-CASH), 10, 18 (D-034) | M4, M5 |
| §8.2 | Tasks | 06 (FR-TASK), 18 (D-037) | M1 |
| §8.3 | Customer email | 06 (FR-MAIL), 18 (D-036) | M6 |
| §8.4 | Employees | 06 (FR-EMP) | M1 |
| §8.5 | Trash | 06 (FR-TRASH), 12, 18 (D-035) | M1 |
| §9 | Dashboards and reports | 10, 18 (D-041) | M3, M5, M7, M9 |
| §10 | Data model | 03, 04 | all |
| §11 | Integrations, technical requirements, migration | 11, 12, 15, 22, 26, 18 (D-039, D-042–D-044) | M1, M9, M10 |
| §12 | Milestones, acceptance criteria, open questions | 14, 16, 18, 21, 27 | all |
