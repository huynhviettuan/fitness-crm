# Documentation Changelog

## 2026-10-11 — Slice plan

- New `docs/28_SLICE_PLAN.md`: every remaining slice from M2.5 to M11. Each slice lists what it builds, its sources, data, API, and screens, the tests the test agent writes, the decisions to settle before coding, and what it depends on. Plan-level proposals: the consulting-Excel import moves to M3 for AC-08; a shared Excel export in M3.1; file storage in M4.1; staging before the M2 trial; an email outbox from M5.4.
- Docs: 16, README.

## 2026-10-11 — M2 slice 4: Show, No show, Báo Studio, ID encryption

- **Show** (D-019, brief §3): "Show – chuyển thành khách hàng" on the lead asks for the CCCD or passport, birth date, nationality, email, phone, an optional basic health note, and the customer's consent to keep them (D-042). The lead becomes a customer in the same record, with a KH code, and its page opens. Any lead in its journey can show, walk-ins too (A-061).
- **No show**: a booked lead that did not come goes to No show, due for re-care.
- The checklist step "Ghi nhận Show / No show" does the same: its results carry the effect, so recording it on the lead or in "Việc hôm nay" converts or sends to re-care. Admin sets effects per result.
- **Báo Studio** (brief §4.1, §8.2): right after each pre-visit reminder the system tells the studio through Giao việc: one task about the lead (appointment, Assessment type, Pain Status), made the first time and updated with a comment the second. Its department is a new parameter, "Phòng ban nhận Báo Studio"; who the coach Manager is is OQ-032.
- **Encryption** (D-042, T-052): ID numbers and health notes are encrypted with AES-256-GCM before they reach the database; the history only records that they were given. New setting `FIELD_ENCRYPTION_KEY`. New hideable fields: ID document and health note (A-060).
- The customer page shows the nationality, ID document, health note, and consent date.
- API: `/leads/:id/show`, `/leads/:id/no-show`; tasks can be about a lead.
- Tests: unit (shared 126, web 281, API 119), integration 289, E2E and security 335.
- Docs: 04, 07, 09, 13, 15, 16, 18 (T-064, A-059 to A-061, OQ-032), 24, 25.

## 2026-10-11 — M2 slice 3: consulting checklist

- **Checklist per lead** (brief §4.1, D-020): every new lead gets the brief's ten steps. A step opens, with a deadline, when its moment comes: the lead is assigned, goes to No response, gets an appointment (reminders 3 hours and 60 minutes before), an earlier step is done (Báo Studio), or enters re-care. The consultant records each step with a result from its own list and an optional note; it is marked on time or late, with who and when. "Đặt lịch" is done by booking the visit itself (A-057).
- **Việc hôm nay** (FR-LEAD-005): a new menu item lists the steps due today and the overdue ones, mine or all, with a "Hoàn thành" button on each; it works on a phone. The person in charge gets a notification when a step comes due.
- **Administration → Checklist tư vấn**: admin adds, removes, renames, and reorders steps, sets what opens each one and its delay, its results, whether it is required, and whether it completes itself. Saving makes a new version for new leads; leads already started keep theirs.
- Báo Studio, Show / No show, and re-care results are recorded now; creating the coach manager's task, converting to a customer, and re-care follow in slices 4 and 5.
- API: `/leads/:id/steps`, `/leads/:id/steps/:stepId/complete`, `/leads/today`, `/consulting-checklist`; notification `leadStepDue`.
- Tests: unit (shared 122, web 278, API 113), integration 275, E2E and security 322.
- Docs: 02, 04, 07, 09, 13, 16, 18 (T-063, A-055 to A-058), 24, 25.

## 2026-10-11 — Code style: Prettier and ESLint readability rules

- **Prettier** formats the whole repository: 120-character lines, double quotes, semicolons, trailing commas, and Tailwind classes in their canonical order (`prettier.config.mjs`). Markdown, generated files, and the customer's brief are left as written (`.prettierignore`). `pnpm format` formats; CI runs `pnpm format:check`.
- **ESLint** gains readability rules shared by every package, the web app included (`packages/config/eslint.mjs`): type-only imports marked as such, `===`, braces around multi-line bodies, shorthand properties, template strings. `eslint-config-prettier` keeps ESLint out of formatting.
- VS Code formats on save and fixes lint problems on save (`.vscode/`).
- The one-time reformat changes no behavior; `.git-blame-ignore-revs` hides it from `git blame`.
- Fixed: on a phone, the Kanban board could make the page scroll sideways when a column further right held an appointment; its screen-reader label escaped the board's scroll area.
- Docs: AGENTS.md (§4, §8), README.

## 2026-10-11 — M2 slice 2: lead assignment and statuses

- **Round-robin** (BR-203): a new lead goes in turn to the branch's consultants (users with the new permission "receive leads", initially the Consulting role) and starts *Đang tư vấn*. With nobody to receive it, it stays *Mới*. The consultant is told; the branch's managers are told of every new lead (A-052).
- **Reassigning**: Admin and Fitness Manager (new permission `lead.assign`) hand a lead to another consultant of its branch from the lead page.
- **Status flow** (D-020): "Đổi trạng thái" offers only the moves allowed from the current status. *Đã đặt lịch* needs the appointment's day and time (in the future); *Từ chối* needs a reason from the new list "Lý do từ chối (lead)"; *Chưa phản hồi*, *Từ chối*, and *No show* get a day to contact them again, 15 days later (new parameter "Tái chăm sóc sau", OQ-018). A note can go with any change. Show and No show arrive with appointments (slice 4).
- **History**: the lead page shows the journey (status since when, person in charge, appointment, reason, contact-again day) and every status change and assignment with who and when.
- **Kanban**: the Lead page switches between the list and a board with a column per status; it scrolls inside itself on a phone.
- API: `/leads/board`, `/leads/:id/timeline`, `/leads/:id/status`, `/leads/:id/assignees`, `/leads/:id/assign`; notifications `leadNew`, `leadAssigned`.
- Tests: unit (shared 117, web 269, API 108), integration 263, E2E and security 298.
- Docs: 04, 07, 09, 13, 16, 18 (T-062, A-052 to A-054), 24, 25.

## 2026-10-11 — M2 slice 1: leads

- **One person, one record** (D-019): a lead and a customer are the same record; the customers table gains a stage, a lead code (prefix LD, a parameter), the lead status, and the lead profile of brief §4.1. Existing customers stay customers. Customer screens show only customers; a lead cannot have a contract before Show.
- **Lead** menu: list with filters (status, channel, source, need) and search; quick intake form, phone-first and full-screen on phones (name, phone, channel; the rest folds out); lead page; edit. Every lead starts as New with nobody in charge (assignment arrives in slice 2).
- New option lists with the brief's values: contact channels, lead sources, need groups, Pain Status, Assessment types. Source type (Organic/Paid) and nationality group are fixed values (A-049).
- **A phone belongs to one person**: adding a lead or customer with a phone already in the system is refused, and the form links to that record (A-051). The merge arrives in slice 5.
- Fixed: on a phone, the top bar no longer makes every page scroll sideways.
- Permissions `lead.view`, `lead.create`, `lead.manage`; data scope "leads" (Consulting: only their own).
- API: `/leads`, `/leads/:id`; error `PHONE_ALREADY_USED`.
- Tests: unit (shared 105, web 264, API 103), integration 247, E2E and security 277.
- Docs: 04, 07, 09, 13, 16, 18 (T-061, A-049 to A-051), 24, 25.

## 2026-10-11 — M1 slice 7: tasks and notifications

- **Công việc** (brief §8.2, D-037): give a task to a person or a department, with a deadline and priority, optionally about a customer or contract (a "Giao việc" button on their pages). The assignee — or the first member of the department — accepts it, starts, and completes it; the assigner can edit or cancel it. Views: my tasks, tasks I gave, my department's, and all (Admin, Fitness Manager); filters by status and overdue; overdue tasks are marked. Comments with mentions.
- **Notifications** (FR-PLT-009): a bell in the top bar with the unread count and the latest ones, and a Notifications page. Users are told when a task is given to them, accepted, completed, cancelled, commented on, mentions them, comes due, or goes overdue; approvers when a request arrives; submitters when it is decided.
- **Reminders** (T-059): pg-boss in PostgreSQL runs every minute. Tasks remind their assignee 24 hours before the deadline (parameter) and tell both sides when it passes (A-046); overdue approval requests remind the approvers and tell their superiors (A-037, A-047). In production the API runs with `RUN_JOBS=false` next to a worker process `node dist/worker.js`.
- "Việc của tôi" shows how many requests wait for the user's approval and links to the inbox (A-044).
- Permissions `task.view` and `task.create` for every role; data scope "tasks" (A-045, A-048).
- API: `/tasks` (and `/summary`, `/assignees`, `/:id/accept|start|complete|cancel`, `/:id/comments`), `/notifications` (and `/summary`, `/:id/read`, `/read-all`). New dependency: pg-boss.
- Tests: unit (shared 99, web 253, API 99), integration 233, E2E and security 259.
- Docs: 04, 07, 09, 13, 15, 16, 18 (T-059, T-060, A-044 to A-048, OQ-031), 24, 25.

## 2026-10-11 — M1 slice 6: employees and PT working schedules

- Trainers became **employees** (brief §8.4), keeping their ids, codes, logins, and bookings: profile with birth date, gender, phone, email, department and job title from new option lists, team, branch, working status, "teaches PT", and one linked login. New codes use the employee prefix (initially NV). Administration → **Employees** replaces Trainers: list with filters and search, detail page, add and edit.
- **Working schedules** (D-030): weekly shifts and days off on the employee's page. A booking or reschedule must fall inside the trainer's working hours and not on a day off; the PT calendar greys every other cell. Existing trainers got 05:00–22:00 every day so nothing changed for them (A-042).
- Permissions `employee.view` and `employee.manage` replace `trainer.*`; new data scope "staff": a PT sees their own profile and schedule, read-only. Master, Receptionist, and Kế toán no longer read staff profiles (A-043).
- ID documents wait for field encryption in M2 (A-041).
- API: `/employees` (and `/logins`, `/:id/schedule`, `/:id/shifts`, `/:id/days-off`), `/schedule/trainers?date=`; `/trainers` removed; `GET /me` has `employeeId` instead of `trainerId`; error `BOOKING_OUTSIDE_WORKING_HOURS`.
- Tests: unit (shared 93, web 233, API 84), integration 214, E2E and security 230.
- Docs: 04, 07, 09, 13, 16, 18 (T-058, A-041 to A-043; A-030 superseded), 24, 25.

## 2026-10-11 — M1 slice 5: approvals

- Maker-checker (D-018): receipts, income and expenses, deletions to the trash, and changes of a customer's name, phone, or email wait for approval as the matrix says; until then they have no effect. Nobody approves their own request. Rejections take a reason from the new "rejectReasons" list.
- **Approvals** inbox (top bar, with a count): requests to decide, requests I sent, and all requests for admins; overdue ones are flagged (A-037).
- **Administration → Approval matrix**: per action, whether approval is needed, which roles approve, and when a request is overdue; changes apply at once (`approval.manage`). Initial matrix from doc 09: receipts and cash by Fitness Manager or Admin, deletions by Admin, identity edits by Fitness Manager.
- Receipts and cash entries show their approval status and count only when approved; pending receipts count toward the contract value cap (A-038). A contract's creator can no longer activate it (A-039).
- API: `202` for actions under approval; `/approvals`, `/approvals/summary`, approve, reject, `/approval-rules`; errors `APPROVAL_OWN_REQUEST`, `APPROVAL_NOT_PENDING`, `APPROVAL_ALREADY_PENDING`.
- Tests: unit (shared 85, web 227, API 78), integration 200, E2E and security 216.
- Docs: 04, 07, 09, 13, 16, 18 (T-057, A-037 to A-040), 24, 25, AGENTS.md.

## 2026-10-10 — M1 slice 4: audit and trash

- Action history (T-048): every change is recorded with its values before and after, in columns of their own; earlier events were converted. **Administration → Action history** searches by kind of record, record, user, and day (`audit.view`).
- Trash (D-035): payments and cash entries are deleted to the trash with a reason from the list instead of being voided. They leave lists, totals, and debt; the trash keeps them forever with who, when, why, and the record as it was. **Administration → Trash** is read-only (`trash.view`). Earlier voided records are in the trash with their reason.
- API: `DELETE /payments/:id` and `DELETE /cash-transactions/:id` with `{ reasonId, reasonNote }` replace the void endpoints; new `GET /trash` and `GET /audit-events`. Payments and cash entries no longer have a status.
- Permissions: `payment.void` → `payment.delete`; new `cash.delete`, `audit.view`, `trash.view`. The Fitness Manager no longer deletes cash entries (A-036).
- Tests: unit (shared 83, web 215, API 72), integration 185, E2E and security 207.
- Docs: 07, 09, 13, 16, 18 (T-056, A-036; T-047, A-008, A-009 notes), 24, 25, AGENTS.md.

## 2026-10-10 — M1 slice 3: configuration

- Option lists (D-016): payment methods, income categories, expense types, and delete reasons are admin lists with "Khác", which needs a note. Admin adds, renames, reorders, and switches options off on **Administration → Option lists**, which also lists the notes written with "Khác". Switched-off options stay on old records. The migration keeps every existing method, category, and void reason (A-035).
- Payments, cash entries, and voids use the shared `OptionSelect`; records show the choice with its note.
- System parameters (T-049): PT calendar hours (no longer environment variables) and the customer, contract, and trainer code prefixes, on **Administration → System parameters**. Changes apply at once and are audited.
- New permission `config.manage` (Admin).
- Tests: unit (shared 81, web 208, API 70), integration 173, E2E and security 202.
- Docs: 04, 07, 09, 13, 15, 16, 18 (T-055, A-034, A-035; T-038 and A-003 notes), 23, 24, 25, AGENTS.md.

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
