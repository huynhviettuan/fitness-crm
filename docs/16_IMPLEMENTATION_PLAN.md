# 16 — Implementation Plan

Phase 1 follows the brief's delivery order (brief §12). Each milestone ends as a working version on **staging** for the owner to try; the owner can cut or postpone milestones. Effort and cost per milestone: `27_ESTIMATES.md`. What is reused from the code built so far and what is reworked: `25_BRIEF_V2_GAP_ANALYSIS.md`.

Work inside a milestone in **vertical slices**: schema and migration → API service with rules, permissions, audit → endpoint with OpenAPI → screen → unit, integration, E2E, and security tests → docs. Stopping between slices leaves nothing half done. Every remaining slice, with its tests and the decisions to settle before coding, is in `28_SLICE_PLAN.md`.

## Milestones

| # | Milestone | Scope | Reuses from Phases 0–4 | Acceptance |
|---|---|---|---|---|
| M1 | Foundation | Monorepo restructure (`26_TECH_PROPOSAL.md` §8); sign-in, users, roles and permission tree, overrides, data scope, masks, access hours, login history; branches; employees and PT schedules; option lists with "Khác"; system parameters; approval engine and matrix; audit log with before/after; trash; in-app notifications; Tasks module | Better Auth, user management, audit writer, security layer, design system, test setup | AC-01–AC-05, AC-13 |
| M2 | Leads and consulting | Manual intake, round-robin assignment, timed checklist and reminders, "Today's tasks", re-care, script library, Kanban, duplicate merge, convert to customer | Customer module (becomes the person record), search | AC-03, AC-06, AC-07, AC-09, AC-23 |
| M3 | Audit and consulting dashboard | Rule-based audit, manager audit, consulting dashboard, lead analysis | — | AC-08 |
| M4 | Contracts and cash book | Services and price tiers, promotions, contract form with approval and exception price, locked contracts, deletion with trash, deactivation; receipts, expense vouchers, cash book, debt; contract and exception-price reports | Contract module (idempotency, locks, derived figures), payments (becomes receipts), cash (becomes vouchers) | AC-02, AC-05, AC-09–AC-14, AC-19 |
| M5 | PT schedule, classes, sessions | PT grid (rows per PT, week view, working schedules), configurable session statuses with snapshots, customer overlap, admin "Đã tập" in bulk, delete from history, Burn Show, classes and attendance, PT revenue allocation, PT payouts and adjustments, booking report | PT calendar, booking and session services, locked transactions, overlap constraint | AC-02, AC-09, AC-11, AC-15, AC-16, AC-18, AC-23 |
| M6 | Automatic email infrastructure (built first, from the start of M4; D-059) | Provider, outbox, templates in VI/EN, session credited and refunded emails, optional events, failure tasks | — | AC-17 |
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
| M1 | 5. Approvals: engine, matrix screen, inbox with top-bar count; receipts, income and expenses, deletions, and customer identity edits under approval; a contract's creator cannot activate it (D-018, T-057) | **Done** 2026-10-11 |
| M1 | 6. Employees: trainers turned into employees with profiles, departments and job titles, linked logins; weekly shifts and days off; bookings only inside working hours; grey cells on the PT calendar (T-058, A-041 to A-043) | **Done** 2026-10-11 |
| M1 | 7. Tasks and notifications: give tasks to a person or department, accept, work, complete, cancel, comments with mentions; bell and Notifications page; reminders before and after deadlines and for overdue approvals, run by pg-boss (D-037, T-059, T-060, A-044 to A-048) | **Done** 2026-10-11 |
| M1 | All slices built; next: the owner checks AC-01 to AC-05 and AC-13 on staging | — |
| M2 | 1. One person record and lead intake: the customers table gains the stage, lead code, lead status, and lead profile; quick form (phone-first), lead list and page; five option lists with the brief's values; one phone per person (T-061, A-049 to A-051) | **Done** 2026-10-11 |
| M2 | 2. Assignment and statuses: round-robin to the branch's consultants, reassignment by managers, notifications; the status flow with appointment, refusal reason, and contact-again day; timeline; Kanban (T-062, A-052 to A-054) | **Done** 2026-10-11 |
| M2 | 3. Consulting checklist: versioned steps with triggers, delays, results, and required flags; admin editor; a lead's checklist with deadlines, results, on time or late; "Việc hôm nay"; reminders when a step comes due (T-063, A-055 to A-058) | **Done** 2026-10-11 |
| M2 | 4. Show and No show: Show converts the lead to a customer in the same record with the ID document, health note, and consent; No show to re-care; checklist results with effects; Báo Studio tasks for the studio's department; ID numbers and health notes encrypted (T-064, A-059 to A-061, OQ-032) | **Done** 2026-10-11 |
| M2 | 5. Re-care and merge: the re-care list (status, consultant, overdue, mine or all); the re-care step's results book the lead again or refuse it with the next contact-again day; a duplicate phone offers "Gộp vào hồ sơ này" (inquiry on the existing record); managers merge two records of one person (T-065, A-062 to A-068, OQ-033) | **Done** 2026-10-12 |
| M2 | 6. Scripts, notes, and the customer profile: the script library (12 seeded situations, answers in two languages, copy on the lead, managers edit and order); dated notes on the lead's timeline; the customer's address, emergency contact, group, and staff in charge; list filters (branch, staff, registration days, birthday month, no email) and the Consulting history tab (A-069 to A-076) | **Done** 2026-10-12 |
| M2 | 7. Customer feedback follow-up (D-046 to D-072 and `28_SLICE_PLAN.md`): lead form without a phone, nationality as a country list, weighted assignment with receiving on/off, reclaim after 1 hour in 08:30–20:30, checklist lock, several reminder points, direct manager, departments and titles | **Done** 2026-10-12 |
| M2 | All slices built, M2.7 included (the full E2E suite passed at its close); next: the owner trial on staging for AC-03, AC-06, AC-07, AC-09 (lead part), and AC-23 (leads) | — |
| M3 | 1. Excel export: one writer, one permission per list, the screen's filters, scope, and masks, an audited and row-limited download from the nine lists (A-077 to A-080) | **Done** 2026-10-12 |
| M3 | 2. Rule-based consulting audit: each step on time, late, or skipped; compliance and score per lead and per consultant; configurable criteria (need group, phone, refusal reason); the Audit card on a lead, the consultants' table, and "Leads to check" for managers (A-081 to A-085) | **Done** 2026-10-12 |
| M3 | 3. Manager audit: a manager grades a lead Pass or Fail with a comment and the criteria not met (an admin list); every grade is kept, the latest counts, and whoever sees the lead sees it; the queue "Chưa audit" and each consultant's count (A-086 to A-088) | **Done** 2026-10-12 |
| M3 | 4. Consulting dashboard and lead analysis: the funnel, rates, compliance, first response, and re-care per consultant and for the team; the leads by channel, source, Organic or Paid, need, nationality, and refusal reason with the notes of "Khác"; filters by period, branch, and staff; one shared chart; Excel exports; four report permissions (A-089 to A-094) | **Done** 2026-10-12 |
| M4 | 0. Email infrastructure (M6.1, first by P-6): the outbox, the `mail` worker with Resend, retries, a task for reception when an email finally fails, and the customer's "Emails sent" tab (A-106, OQ-036) | **Done** 2026-10-12 |
| M4 | 1a. Services and price tiers: services with branches, hours, commission, group limits, and validity; the price list in versions with a start day; quick-pick packages; the lookup of unit price, total, name, and end date for any session count; the admin screens (A-107 to A-109, OQ-037). 1b, file storage and the service image, remains | **Done** 2026-10-12 (1a) |
| M4 | 2. Promotions and approval thresholds: promotions and vouchers (percent or amount, dates, services) applied to the tier price and not exception prices; the quote of a price with promotion, voucher, and VAT; each role's discount limit (A-110 to A-112, OQ-038) | **Done** 2026-10-12 |
| M4 | 3. Contract model and creation: the price from the service's tier at the contract date, promotion, voucher, VAT, exception price with a reason, bonus, PT and Sale shares, companions, signature, first payment saved with the contract, idempotent create; the contract form is a page with a live price panel; existing contracts are kept and flagged as imported (A-113 to A-119, OQ-039, OQ-040) | **Done** 2026-10-12 |
| M4 | 4a. Approval, lock, unapprove, delete: a new contract waits in the approval inbox and is approved or rejected (with a reason) by someone else; an approved contract is locked by the service and a database trigger, even for Admin; the lead status turns to "Đã ký hợp đồng"; Admin can unapprove (no receipts or sessions) and delete to the trash (receipts and sessions listed first) (A-120 to A-125, OQ-041, OQ-042). 4b, the list, detail tabs, print, and note, remains | **Done** 2026-10-14 (4a) |
| M4 | 4b. The contract list and detail: every column of the brief, nine filters, the totals of the filter, the Excel export with the same filters; the detail has Information, Check-in history, and Package history tabs, a print sheet, and an update-note action that works on approved contracts (A-126 to A-128, OQ-043) | **Done** 2026-10-14 (4b) |
| M4 | 5. Receipts and expense vouchers: numbers that are never reused (PT, PC), the salesperson and note of a receipt, the payee and method of a voucher, the date edit as its own permission, the payment status of a contract, and a customer's standing derived from contracts (A-129 to A-132, OQ-044). The transfer proof image waits for file storage | **Done** 2026-10-14 (5, without the proof image) |
| M7 | 1. Workout catalogs: equipment, a tree of body areas, Strength or Cardio exercises with a video link, plan stages, and the option lists of the log with the brief's values (A-188 to A-191, OQ-057) | **Done** 2026-10-25 |
| M6 | 4. Staff notifications by email and push to the phone (the home-screen app, Web Push, each employee's choices, Admin's mandatory marks; proposal and limits in doc 29) (A-183 to A-187) | **Done** 2026-10-24 |
| M6 | 3. The optional customer emails with their on/off switch: contract activated or renewed, receipt, hold, active again, cancelled, ending soon, running out (A-181, A-182) | **Done** 2026-10-23 |
| M6 | 2. Email templates in Vietnamese and English that admin edits, and the credited, no-show, Burn Show, refund and class emails, exactly one per change, in the language of the customer's nationality group (A-177 to A-180, OQ-055) | **Done** 2026-10-22 |
| M5 | 7. PT payouts: an expense voucher per PT and period with the sessions it paid (never paid twice, also under concurrent requests), and adjustments for paid sessions deleted since (A-173 to A-176, OQ-054) | **Done** 2026-10-21 |
| M5 | 6. PT revenue allocation (a row per PT and contract, totals per PT, in and outside the shift, Excel in GymMaster's order), the booking report, and the first overview dashboard (A-166 to A-172, OQ-053) | **Done** 2026-10-20 |
| M5 | 5. Class schedule and attendance: weekly classes with a coach and a capacity, sessions made ahead, enrollment on a group-class contract (refused when full, expired, or out of sessions), present uses one session, the week board, and the contract's sessions used include class attendance (A-160 to A-165, OQ-052) | **Done** 2026-10-19 |
| M5 | 4. Delete from the check-in history and Burn Show: a trained session is deleted with a reason (one session refunded, the PT credit removed, to the trash, the customer emailed) and Admin adds one by hand with a reason; both are Admin's (A-157 to A-159, OQ-051) | **Done** 2026-10-18 |
| M5 | 3b. Fingerprint-ready check-in: machines with their own keys, the scan API, raw scans, the pairing of the customer's and the PT's scans into the one event "session confirmed", the error list, hanging sessions with the PT's answers and the 24-hour escalation, the machine user codes, and the report of confirmations by hand (A-153 to A-156, OQ-050) | **Done** 2026-10-17 |
| M5 | 3. Session dialog and bulk: Đã tập straight from Booked, Xóa for a session booked by mistake (to the trash with a reason), bulk Đã tập for a day with a result per session, and the confirmation method kept (A-150 to A-152) | **Done** 2026-10-16 |
| M5 | 2. PT grid and booking: every cell bookable (shifts only tint, D-058), day and week views, filters by branch, PT, and customer, a count per column, phone width; a customer-overlap constraint; the service's hours and daily and weekly limits (A-149, OQ-049) | **Done** 2026-10-16 |
| M5 | 1. Configurable session statuses: Booked, Đã tập, Hủy lịch, Khách không đến as rules Admin edits (uses a session, credits the PT, locked once set, color); each session keeps the rule applied when its status was set; check-in is a fact on a Booked session; a no-show now uses a session; the cancel cut-off parameter (A-145 to A-148, OQ-048) | **Done** 2026-10-15 |
| M4 | 1b. Private file storage: pictures uploaded for a purpose, kept in a private folder or R2, shown only through links signed for the user that expire in five minutes; the service picture and the transfer proof of a receipt (A-143, A-144, OQ-047) | **Done** 2026-10-15 |
| M4 | 7. Cash book and reports: the cash book per day and period (opening, in, out, closing per branch and method; closing = opening + in − out), Admin's opening balance, the income and expense report, the member debt export, the contract report, and the exception-price report, each with Excel and its own permission (A-138 to A-142, OQ-046) | **Done** 2026-10-15 |
| M4 | 6. Deactivation and reactivation: a frozen contract is not booked, checked in, or completed and does not expire; reactivating shows the frozen days and the proposed end date, and the end date changes once; a freeze over 10 days reminds the managers and makes a task (A-133 to A-137, OQ-045) | **Done** 2026-10-14 |
| M3 | Next: M3.5 the consulting-Excel import, which needs the owner's anonymized file (`28_SLICE_PLAN.md`) | Not started |

## Open questions per milestone

Build the interim behavior from `18_DECISIONS_ASSUMPTIONS.md` and leave the blocked part until answered.

| Milestone | Open questions |
|---|---|
| M1 | OQ-024, OQ-026, OQ-028, and OQ-029 answered on 12/10/2026 (D-046, D-047, D-053, D-067, D-054); TS-004, TS-005 |
| M2 | OQ-017, OQ-018, OQ-019, and OQ-020 answered on 12/10/2026 (D-050, D-051, D-052, D-049); built in M2.7; OQ-034 (title → role table and Marketing reporting lines) |
| M4 | OQ-003 (overpayment), OQ-010 (group packages), OQ-013 (cancellation settlement), OQ-015 answered |
| M5 | OQ-001 (dates), OQ-008 (overbooking), OQ-021 (class revenue), OQ-022 (rates), OQ-027 (when a machine is attached; the scan flow is built, D-069), TS-009 (NextFace ID survey, answered before M5) |
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
