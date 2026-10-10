# 16 — Implementation Plan

Phase 1 follows the brief's delivery order (brief §12). Each milestone ends as a working version on **staging** for the owner to try; the owner can cut or postpone milestones. Effort and cost per milestone: `27_ESTIMATES.md`. What is reused from the code built so far and what is reworked: `25_BRIEF_V2_GAP_ANALYSIS.md`.

Work inside a milestone in **vertical slices**: schema and migration → API service with rules, permissions, audit → endpoint with OpenAPI → screen → unit, integration, E2E, and security tests → docs. Stopping between slices leaves nothing half done.

## Milestones

| # | Milestone | Scope | Reuses from Phases 0–4 | Acceptance |
|---|---|---|---|---|
| M1 | Foundation | Monorepo restructure (`26_TECH_PROPOSAL.md` §8); sign-in, users, roles and permission tree, overrides, data scope, masks, access hours, login history; branches; employees and PT schedules; option lists with "Khác"; system parameters; approval engine and matrix; audit log with before/after; trash; in-app notifications; Tasks module | Better Auth, user management, audit writer, security layer, design system, test setup | AC-01–AC-05, AC-13 |
| M2 | Leads and consulting | Manual intake, round-robin assignment, timed checklist and reminders, "Today's tasks", re-care, script library, Kanban, duplicate merge, convert to customer | Customer module (becomes the person record), search | AC-03, AC-06, AC-07, AC-09, AC-23 |
| M3 | Audit and consulting dashboard | Rule-based audit, manager audit, consulting dashboard, lead analysis | — | AC-08 |
| M4 | Contracts and cash book | Services and price tiers, promotions, contract form with approval and exception price, locked contracts, deletion with trash, deactivation; receipts, expense vouchers, cash book, debt; contract and exception-price reports | Contract module (idempotency, locks, derived figures), payments (becomes receipts), cash (becomes vouchers) | AC-02, AC-05, AC-09–AC-14, AC-19 |
| M5 | PT schedule, classes, sessions | PT grid (rows per PT, week view, working schedules), configurable session statuses with snapshots, customer overlap, admin "Đã tập" in bulk, delete from history, Burn Show, classes and attendance, PT revenue allocation, PT payouts and adjustments, booking report | PT calendar, booking and session services, locked transactions, overlap constraint | AC-02, AC-09, AC-11, AC-15, AC-16, AC-18, AC-23 |
| M6 | Customer email | Provider, outbox, templates in VI/EN, session credited and refunded emails, optional events, failure tasks | — | AC-17 |
| M7 | Workout plans and logs | Catalogs, templates, customer plans, three-part session log, Flags and Actions, escalation, progress tab, weekly workout dashboard | — | AC-20, AC-21, AC-23 |
| M8 | Contract change vouchers | Renewal, upgrade, hold, transfer, branch transfer, conversion, cancellation with refund | Contract cancellation cascade (D-010) | (D-024) |
| M9 | Remaining reports and import | Overview dashboard, remaining reports and exports; GymMaster import with cleanup list and reconciliation; consulting Excel import; staging trial and parallel run | Opening balances (D-011) | AC-22 |
| M10 | Lead channel APIs | Channels in order of feasibility after the survey (TS-007) | — | (D-044) |
| M11 | AI-assisted audit | After chats are in the system and OQ-025 is answered (TS-008) | — | (D-045) |

## Progress

| Milestone | Slice | Status |
|---|---|---|
| M1 | 1. Monorepo restructure: pnpm + Turborepo; `apps/web`, `apps/api` (NestJS), `packages/shared`, `packages/config`, `e2e`; web calls the API through the generated client (T-043, T-053) | **Done** 2026-10-10 (`26_TECH_PROPOSAL.md` §8) |
| M1 | 2. Branches and the permission tree: configurable roles, per-user overrides, data scope, hidden fields, branch access, allowed hours, login history; endpoint permission guard (T-046, T-054); admin screens for users, roles, branches | **Done** 2026-10-10 |
| M1 | 3. Configuration: option lists with "Khác" (payment methods, income categories, expense types, delete reasons), system parameters (PT calendar hours, code prefixes), admin screens, `OptionSelect` (D-016, T-049, T-055) | **Done** 2026-10-10 |
| M1 | 4. Audit with before and after values for every change; the trash; payments and cash entries deleted to the trash instead of voided; Action history and Trash screens (T-048, D-035, T-056) | **Done** 2026-10-10 |
| M1 | Next: 5 approvals, 6 employees, 7 notifications and tasks | Not started |

## Open questions per milestone

Build the interim behavior from `18_DECISIONS_ASSUMPTIONS.md` and leave the blocked part until answered.

| Milestone | Open questions |
|---|---|
| M1 | OQ-024 (departments), OQ-026 (staff email), OQ-028 (sizing), OQ-029 (approval of daily operations), TS-004, TS-005 |
| M2 | OQ-017 (assignment rule), OQ-018 (15 or 16 days), OQ-019 (reclaim), OQ-020 (Master per branch) |
| M4 | OQ-003 (overpayment), OQ-010 (group packages), OQ-013 (cancellation settlement), OQ-015 answered |
| M5 | OQ-001 (dates), OQ-008 (overbooking), OQ-021 (class revenue), OQ-022 (rates), OQ-027 (devices) |
| M8 | OQ-023 (fees, approvals, hold limit), OQ-030 (cancellation cascade) |
| M9 | OQ-014 (go-live, volume, cleanup sign-off) |
| M11 | OQ-025 (AI consent and criteria) |

## Before starting M1

The brief asks the developer to send, before starting (brief §12):

| Item | Where |
|---|---|
| Technology proposal and architecture diagram | `26_TECH_PROPOSAL.md` |
| Detailed database schema | `04_DATA_MODEL_ERD.md` |
| Wireframes for Leads, PT calendar, session log, and permissions | `docs/wireframes/flow-fitness-wireframes.html` |
| Time and cost per milestone, monthly infrastructure cost including email | `27_ESTIMATES.md` |
| Lead channel survey and AI audit options | TS-007, TS-008 (before M10 and M11) |

## History: Phases 0–4 (first brief)

Built 2026-10-09 to 2026-10-10 from the first brief, as one Next.js app: foundation, identity and customers, contracts, PT bookings and sessions, finance. The Phase 5 plan (dashboard and reports in four slices) is replaced by M3, M5, M7, and M9. Details are in `CHANGELOG.md` and in the gap analysis.
