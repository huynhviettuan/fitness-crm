# Documentation Changelog

## 2026-10-10 — M1 slice 2: branches and the permission tree

- Branches: every customer, contract, trainer, session, receipt, and cash entry has a branch; users are granted branches (or all); other branches' records answer `404`. A migration moves existing data to "Chi nhánh chính" (A-031, A-032).
- Configurable roles replace the five fixed roles: permission tree, data scope (*all* or *only mine*, A-029), hidden fields, clone; per-user permission overrides; allowed sign-in days and hours; login history with the refusal reason (A-033). Seven default roles plus the migrated "Kế toán".
- API: every endpoint declares its permission (`x-permission` in OpenAPI); new `/roles`, `/branches`, and user endpoints for branches, overrides, access hours, and logins; `GET /me` returns scopes, branches, and hidden fields.
- Web: Administration → Users (with a detail page), Roles, Branches; branch choice on new customers, trainers, and cash entries; hidden values shown as "Đã ẩn"; customers and contracts pages check their view permission.
- Tests: unit (shared 73, web 191, API 63), integration 158, E2E and security 191.
- Docs: 04, 07, 09, 16, 18 (T-054, A-029 to A-033; A-010 and A-014 amended), 24, 25.

## 2026-10-10 — M1 slice 1: monorepo restructure

The Phases 0–4 code now runs as the planned monorepo, with the same behavior (`docs/26_TECH_PROPOSAL.md` §8).

- pnpm 12 workspaces + Turborepo replace npm. Packages: `apps/web` (Next.js, UI only), `apps/api` (NestJS 12, ES modules), `packages/shared` (Zod input and response schemas, permission keys, error codes, pure domain rules), `packages/config` (lint and TypeScript presets), `e2e` (Playwright).
- `apps/api` owns the services, repositories, Prisma schema and migrations, Better Auth, and the integration tests. Thin controllers keep the old `/api/v1` paths and encode every response with its shared schema; new read endpoints serve the pages. `GET /auth/me` became `GET /me` (with `permissions`) plus `PATCH /me/locale`. The OpenAPI contract is committed as `apps/api/openapi.json`, and CI fails when it drifts.
- `apps/web` has no Prisma or services. Pages and Server Actions call the API through a client generated from `openapi.json`; browsers reach the API through the web app's `/api/*`, which forwards the client address (T-053, new). A unit test enforces the boundary.
- Settings split into `apps/api/.env` and `apps/web/.env`. The API runs on port 4000 and the web on 3000; `pnpm dev` starts both.
- Tests: unit (shared 148, web 163, API 1), integration 136, E2E 169 (the access-control suite now covers every operation in the OpenAPI document).
- Docs: README (setup), AGENTS.md (structure, commands, boundary rules), 07 (current endpoints), 15 (environment variables), 16 (progress), 18 (T-053; T-043 and T-044 amended), 22, 23, 24, 25, 26.

## 2026-10-10 — Brief v2 adopted (Flow Fitness CRM)

The customer's new brief (`docs/source/BRIEF_V2_vi.md`) replaces the first brief. The package now describes Flow Fitness's own CRM replacing GymMaster: 12 modules, multi-branch, configurable roles and approvals, leads and consulting, service price tiers, locked contracts with change vouchers, configurable session statuses (no-show now consumes and credits the PT), workout plans and logs, cash book, tasks, and customer email.

- Architecture changes to a monorepo: `apps/web` (Next.js) and `apps/api` (NestJS), web on Vercel, API and PostgreSQL on Railway or Render (T-041 to T-052).
- New docs: 25 gap analysis (what Phases 0–4 give and what is reworked), 26 technical proposal with monthly costs, 27 estimates per milestone, wireframes for leads, PT calendar, session log, and permissions.
- Rewritten: README, AGENTS.md, docs 00–16, 19–23; updated 17 and 24.
- Doc 18: new decisions D-013 to D-045 and T-041 to T-052; earlier entries keep their IDs with a status (superseded, amended, answered); new open questions OQ-017 to OQ-030; OQ-002, 005, 006, 007, 011, 012, 015, 016 answered.
- Implementation plan: the brief's milestones M1–M11 replace Phases 5–6. The Phases 0–4 code is unchanged until M1.

## 2026-10-10 — Phase 5 plan

- Phase 5 is split into four slices in docs/16.
- D-012: "contracts ending soon" goes by remaining sessions, not the end date; A-023 proposes 3 or fewer.

## 2026-10-10 — Phase 4 (finance) built

- Contract payments (cash, bank transfer, card, e-wallet) with idempotency keys (T-015), the overpayment check under the contract lock (OQ-003 interim, T-040), and void with a reason (A-008). Paid amount and debt now come from confirmed payments (BR-013).
- Income and expenses, corrected by void and re-record (A-009), with month totals that keep contract payments and other income apart (OQ-007 interim).
- Screens: Finance with Payments, Debt, and Income / Expense tabs; payment history on a contract (record and void) and a Payments tab on a customer. Voided amounts are struck through.
- API: contract payments, payment void, cash transactions and their void. New error code `PAYMENT_CONTRACT_CANCELLED`.
- Tests: 190 unit, 136 integration (incl. INT-004, INT-005, and the overpayment race), 156 E2E (incl. E2E-008 and the finance security tests).
- New: T-039, T-040, A-020 to A-022, OQ-016; OQ-013's interim now refuses payments on cancelled contracts.

## 2026-10-10 — Phase 3 (bookings and sessions) built

- Trainers with generated `PT` codes and an optional login link (A-010); bookings with the trainer-overlap exclusion constraint (T-014); manual check-in; completion in the locked transaction of docs/22 §7 (T-013); cancel and no-show; contract cancellation now cancels its booked sessions (D-010, A-018).
- Screens: PT calendar (`TrainerScheduleGrid`), Sessions (today, upcoming, checked in, completed, no-show, cancelled), Trainers, the Bookings tab on a customer, and session history on a contract. The trainer's own day view works at phone width.
- API: trainers, bookings, check-in, complete, cancel, no-show; `GET /auth/me` returns `trainerId`. New error code `CONTRACT_HAS_CHECKED_IN_BOOKING`. Booking times are a day plus `HH:mm` times in the gym timezone (T-038).
- Completed sessions are now counted from bookings (T-012). Trainers see the customers and contracts they have bookings with (OQ-006 interim).
- Tests: 158 unit, 109 integration (incl. INT-001 to INT-003 and INT-007), 126 E2E (incl. E2E-002 to E2E-007 and the booking security tests).
- New: T-036 to T-038, A-016 to A-019. Fixed docs/22 §7 to count opening balances in the remaining-session check (D-011).

## 2026-10-10 — Phase 2 (contracts) built

- Contracts with generated `HD` codes, DRAFT → ACTIVE → CANCELLED with derived EXPIRED, opening balances (D-011), idempotent create (T-015), audited changes, database checks.
- Screens: contracts list, contract detail (sessions, payments, actions with confirmation), Contracts tab on the customer page.
- API: customer contracts list/create, contract get/patch/activate/cancel; error code `CONTRACT_NOT_EDITABLE`.
- Tests: 166 Vitest (incl. INT-008 expiry boundary and double-submit races) and 83 E2E (incl. E2E-001 part 2 and contract security tests).
- New: A-015 (contract permissions), OQ-015 (editing active contracts).

## 2026-10-09 — OQ-004 and OQ-009 answered

- D-010 (OQ-004): cancelling a contract cancels its future bookings; refused while one is checked in. New rule BR-017.
- D-011 (OQ-009): imported contracts carry immutable opening balances (sessions used, amount paid before go-live). New rule BR-018; remaining-session and debt formulas updated in docs 02, 04, 05, 20, and AGENTS.md.
- New open questions: OQ-013 (does a cancelled contract still owe its debt?) and OQ-014 (import details: source system, volume, old customer codes).

## 2026-10-09 — Security testing (OWASP Top 10:2025, layer 1)

- Added `docs/24_SECURITY_TESTING.md`: three-layer plan, per-category controls and tests, findings, security events, dependency triage, deployment requirements.
- Security tests written before the fixes: 8 failed against the existing app, all pass now. 46 new E2E security tests, 10 integration tests, and an 11-test static Server Action guard.
- Fixes: nonce-based CSP and security headers; `X-Powered-By` removed; Origin and JSON checks on `/api/v1` state changes (`UNSUPPORTED_MEDIA_TYPE`); control characters rejected (a NUL byte caused a 500); rate limiting enabled outside production; security event logging; shadcn CLI moved out of runtime dependencies; `mysql2` override; dependency gate with a triaged allowlist; Dependabot.
- E2E now runs against a production build.
- Decisions T-032 to T-035; open items TS-004 (admin MFA) and TS-005 (account lockout).

## 2026-10-09 — Phase 0 and Phase 1 built

The first application code. See `docs/16_IMPLEMENTATION_PLAN.md` for the status and open items.

- Next.js 16.4 + TypeScript strict, Tailwind + shadcn/ui (Radix), next-intl (vi/en), Prisma 7 + PostgreSQL 17 (Docker locally), Vitest, Playwright, a GitHub Actions workflow.
- Better Auth email/password login; disabled users and role changes take effect on the next request.
- Permission matrix, audit writer, user management, and customers (create, edit, accent-insensitive search, detail, Ctrl+K search).
- Tests: 46 unit, 29 integration (real PostgreSQL), 13 E2E.
- Decisions T-028 to T-031 and assumptions A-013, A-014; TS-002 resolved (Better Auth). New API error codes `EMAIL_ALREADY_USED`, `CANNOT_CHANGE_OWN_ACCESS`, `INTERNAL_ERROR`.
- Implementation plan updated: shared components are built with their first feature, the audit writer and user management moved into Phase 1, and each phase ships its own E2E tests.

## 2026-10-09 — UI design system

- Added `docs/23_UI_DESIGN_SYSTEM.md`: shadcn/ui + Tailwind as the only component library, companion libraries, design tokens, status colors, app shell, page templates, shared components, a custom PT calendar grid, device targets, and Playwright-friendly accessibility rules.
- The UI supports Vietnamese and English (next-intl), with the language stored per user; added `user.locale` to the data model.
- Added decisions T-025 to T-027 and assumptions A-011 (default language Vietnamese) and A-012 (device targets).
- Updated `AGENTS.md` with UI rules and the source tree (`messages/`, `src/components/ui/`, `src/i18n/`), and updated the UI spec, implementation plan Phase 0, test strategy, non-functional requirements, and README.

## 2026-10-09 — Gap review

Fixed gaps found in a full documentation review and recorded the remaining unknowns.

Concurrency and money/session safety:

- Replaced the session-completion flow with a locked transaction that is safe under concurrent requests (`22_TECHNICAL_ARCHITECTURE.md` §7, T-013).
- Trainer overlap is now guaranteed by a PostgreSQL exclusion constraint (T-014).
- Contract, payment, and cash-transaction creates require an idempotency key (T-015).
- Added concurrency and duplicate-submission integration tests INT-001 to INT-008.

Model and consistency:

- The booking owns the single lifecycle status; the session is a status-less fulfillment record (T-011). Completed sessions are counted from booking status; the separate "consumption record" was removed (T-012).
- Completed the ERD: users, trainer ↔ user link, void fields, idempotency keys, customer notes, contract creator, cash-transaction reference, and a list of database-enforced constraints.
- `EXPIRED` contract status is derived from the end date, not set by a job (T-018).
- Authentication routes belong to the auth library; `/api/v1` keeps only `GET /auth/me` (T-016). Disabled accounts are rejected on every request (T-017).
- Defined the "limited" RBAC cells; undefined ones are denied (T-024).
- Added an error-code table to the API specification.
- Fixed BR-011 column naming, aligned the `AGENTS.md` source tree with doc 22, and chose Vitest (T-021).

Decisions log (`18_DECISIONS_ASSUMPTIONS.md`):

- Added technical decisions T-011 to T-024 and working assumptions A-001 to A-010.
- Added open questions OQ-008 to OQ-012, and *Blocks* / *Interim* columns for every open question.
- Added a per-phase list of gating open questions to `16_IMPLEMENTATION_PLAN.md`.

## 2026-10-09 — Vercel full-stack architecture update

Updated the V1 architecture from a separate Next.js + NestJS deployment to a single full-stack Next.js application.

Changes:

- Vercel is now the confirmed V1 hosting platform.
- NestJS is removed from the V1 baseline.
- Railway/Render are removed from the V1 baseline.
- PostgreSQL + Prisma remain the persistence baseline.
- Added explicit Server Action / Route Handler → Service → Repository → Prisma boundaries.
- Added Vercel/serverless PostgreSQL connection guidance.
- Updated deployment, implementation plan, AI-agent workflow, roadmap, and technical decisions.
- Added `docs/22_TECHNICAL_ARCHITECTURE.md`.
- Added AI-agent guardrails preventing accidental introduction of a second backend.
