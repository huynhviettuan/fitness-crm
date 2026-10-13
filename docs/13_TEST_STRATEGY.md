# 13 — Test Strategy

## Test pyramid

| Level | Tool | Focus |
|---|---|---|
| Unit | Vitest | Pure rules: price tier lookup and totals, end-date and extension calculations, status-rule application, derived figures (sessions left, paid, debt, PT allocation), permission evaluation (role + overrides + scope + masks), option validation ("Khác" note), timers, `vi`/`en` message keys identical |
| Integration | Vitest against real PostgreSQL | API services with transactions: approvals (no self-approval, no effect while pending), locked contracts, deletion order and trash, consumption under concurrency, overlaps (trainer and customer), idempotency, receipts and debt, payouts without double pay, audit before/after, data scope and masking |
| API contract | Vitest + generated OpenAPI | Every endpoint declares a permission; responses match the schema; masked fields absent |
| E2E | Playwright against web + API | Critical journeys and acceptance criteria (doc 14), desktop and phone viewports |
| Security | Playwright + Vitest | OWASP Top 10 suite (`24_SECURITY_TESTING.md`) for every endpoint |

Integration tests run against a real PostgreSQL database because row locks, exclusion constraints, and unique indexes are PostgreSQL behavior.

## E2E structure

- Specs import `test` and `expect` only from the composition root `e2e/fixtures.ts`; page objects in `e2e/pages/` hold every locator, scoped to the region that owns it.
- One saved session per seeded role; the role and permission seed mirrors `09_RBAC.md`.
- Every test tags the data it creates; fixture teardown removes it, even on failure. Teardown deletes test data directly in the E2E database, outside the trash rules.
- Labels come from the message catalog with the locale pinned to `vi`.
- An open dialog hides the page from the accessibility tree; close it with its own button before asserting on the page.
- E2E runs against production builds of web and API.
- The shared branch has one consultant, so its new leads always go to them. A test that needs its own round-robin makes a branch with its own consultants (`branchWithConsultants`) in a `*.branch.spec.ts` file; those run in the `own-branch` project after the others, since while an extra branch exists, users of every branch must say where a new record goes (D-014). The sign-in rate-limit spec runs last.

### Smoke in CI, everything by hand

The whole Playwright suite is slow, so the CI that runs on every push and pull request runs only `pnpm test:e2e:smoke`: the cases tagged `@smoke` in their title (one per main feature: sign-in, lead, Show, customer, contract and its lock, receipt and approval, booking, completing a session, the PT grid, check-in, cash book, employees, tasks, services) and the OWASP security suite (the `A01` to `A10` describes of `e2e/security`, API-only and fast). `.github/workflows/full-e2e.yml` runs everything, only when started by hand (Actions, Full E2E, Run workflow); run it before closing a milestone. A new main feature gets one `@smoke` case; the rest stay in the full suite.

## Critical scenarios

| ID | Scenario | Criterion |
|---|---|---|
| E2E-101 | Lead from the quick form → assigned round-robin → checklist steps → appointment → Show → converted with the same ID | AC-06, AC-09 |
| E2E-102 | A receptionist types a phone already on a lead: the warning names that lead; "Quay lại sửa" keeps the form; "Gộp vào hồ sơ này" adds the contact (channel, source, need, note) to the existing record, which shows it on its timeline, and leaves one record; for a phone already on a customer the inquiry joins the customer (`e2e/leads.spec.ts`; the API side in `apps/api/test/integration/lead-merge.int.test.ts`) | BR-202, FR-LEAD-009, AC-03 |
| E2E-103 | "Khác" without note refused; option deactivated stays on old record (`e2e/configuration.spec.ts`, `e2e/finance.spec.ts`) | AC-03, AC-04 |
| E2E-104 | Contract form: any session count → tier price, end date, name in the price panel; the draft is created with a generated code and approved by someone else, never its creator (`e2e/contracts.spec.ts`; the pricing rules in `apps/api/test/integration/contracts.int.test.ts`) | AC-10, D-018 |
| E2E-159 | An agreed price is an exception with a reason; it shows against the tier price, and a role whose discount limit it exceeds cannot activate it, Admin can | AC-10, A-112, A-113 |
| E2E-105 | Approved contract cannot be edited by admin: no Edit button, `409 CONTRACT_NOT_EDITABLE`, and the database trigger (`apps/api/test/integration/contract-approval.int.test.ts`, INT-010) | AC-11 |
| E2E-160 | The approver approves or rejects from the contract page; a rejection takes a reason and shows it | D-018, A-121 |
| E2E-169 | (built M5.3b, `e2e/checkin.spec.ts`, `e2e/security/checkin.spec.ts`, `checkin.int.test.ts`, `packages/shared/src/checkin/checkin.test.ts`) A machine is registered and its key shown once; scans pair a session (also in the other order and in one offline batch) with the method device; 15 minutes exactly and 16; the window edges; one session per scan and two PTs in a day; a repeat counts once and a resend is answered from the stored scan; unknown code, no booking, and a deactivated contract are errors; two scans completing one pair together confirm once; a lone scan hangs with the missing side, the PT's request, the manual report, and the 24-hour escalation once; a replaced or switched-off key stops; roles, the machine route's Origin exception, key secrecy, and input errors | D-069 to D-072, AC-29, AC-30 |
| E2E-168 | (built M5.2, `e2e/pt-grid.spec.ts`, `e2e/security/bookings.spec.ts`) On a phone: book from a cell, then the same customer with another PT at an overlapping time is refused; the week view and the customer filter; an off-duty cell is shaded and still bookable (E2E-114); two concurrent bookings of one customer give one winner. `bookings.int.test.ts` for customer overlap, service hours, daily and weekly limits | D-030, D-058, AC-15, AC-23 |
| E2E-167 | (built M5.1, `e2e/session-statuses.spec.ts`) The statuses show the brief's table, a rule opens for editing, Booked offers no flags; only Admin changes them; `apps/api/test/integration/session-statuses.int.test.ts` for a changed rule affecting new changes only, the lock, and the cut-off | D-025, AC-15 |
| E2E-166 | (built M4.1b, `e2e/files.spec.ts`, `e2e/security/files.spec.ts`) Admin adds a service picture and sees it through a signed link, then removes it; a receipt takes a transfer proof; only real pictures within 5 MB, uploaded by roles that may, seen through links made for the user; `apps/api/test/integration/files.int.test.ts` | T-052, A-143 |
| E2E-165 | (built M4.7, `e2e/money-reports.spec.ts`) The cash book of a day closes at opening + in − out for a method; Admin sets the opening balance and the closing moves; it exports; the other reports show and export; a receptionist is refused (`apps/api/test/integration/cash-book-reports.int.test.ts` for AC-19, scope, and exclusions) | AC-19, FR-CASH-005 |
| E2E-164 | A receipt shows its number and salesperson; only Admin edits its date; the customer shows as training (`apps/api/test/integration/receipts.int.test.ts` for numbers, vouchers, and standing) | D-034, D-040, A-129 to A-132 |
| E2E-162 | The contract list filters by approval and payment and totals what the filter matches (`apps/api/test/integration/contract-list.int.test.ts` for every filter) | brief §5.3, A-126 |
| E2E-163 | The detail's three tabs; the note changes after approval; Print opens the sheet | brief §5.3, A-127, A-128 |
| E2E-107 | (built M4.6, `e2e/contracts.spec.ts`) Deactivate with a reason → booking and check-in refused, the booked session highlighted → ten days later reactivate: the dialog proposes the extension → confirmed once (`apps/api/test/integration/contract-freeze.int.test.ts` for INT-008, INT-012, and the reminder) | AC-14, D-023 |
| E2E-161 | Admin unapproves an approved contract, and deletes one: a receipt blocks it and is listed, a second Admin approves the deletion, and it is gone | A-124, A-125 |
| E2E-106 | Delete contract with receipts → blocked with list → delete receipts → delete contract → totals drop; both in trash (receipts part: `e2e/history.spec.ts`, M1 slice 4; contracts in M4) | AC-12, AC-13 |
| E2E-107 | Freeze → booking refused → reactivate → proposed extension → confirm once | AC-14 |
| E2E-108 | Đã tập and no-show consume 1 and credit PT; Hủy lịch and delete do not; colors. (Built M5.3: `e2e/session-ops.spec.ts` for Đã tập from the dialog without check-in and its lock, Xóa from the dialog, bulk Đã tập for a day; `e2e/security/bookings.spec.ts` for the delete and bulk roles, input errors, and own-scope; `sessions.int.test.ts` and `bookings.int.test.ts` for direct completion, bulk with a refused item, and delete) | AC-15 |
| E2E-109 | Đã tập locked; delete from history → refund 1, credit −1, email sent, adjustment in next period | AC-16, AC-17 |
| E2E-110 | Two receipts → paid and debt; cash book balance | AC-19 |
| E2E-111 | Session log on phone: plan and actual per row; cardio fields; escalation reaches manager and Master | AC-20, AC-21, AC-23 |
| E2E-112 | Role without a module: menu hidden and direct URL refused; masked phone absent from screen and export: the role's own file has no phone column and no phone in it (`e2e/admin.spec.ts`, `e2e/security/export.spec.ts`) | AC-01 |
| E2E-113 | Submitter cannot approve own request; approval matrix change takes effect immediately (`e2e/approvals.spec.ts`) | AC-05 |
| E2E-139 | A consultant sees the dashboard of their own leads with no export, and the lead analysis is refused; a receptionist has neither report on the menu or by URL (`e2e/reports.spec.ts`) | A-093 |
| E2E-146 | A manager reads a task's reminder points on its page, a task takes its own typed in hours and a list that cannot be read is refused; the parameter refuses one too (`e2e/tasks.spec.ts`, `e2e/configuration.spec.ts`) | D-056 |
| E2E-147 | The sidebar's groups start closed on the dashboard and the group of the current page is open, with its page marked current (`e2e/navigation.spec.ts`) | A-105 |
| E2E-148 | A group opened by hand is still open after a reload; one never opened stays closed | A-105 |
| E2E-149 | Opening a group shows its pages, and going to a page of a closed group opens it | A-105 |
| E2E-150 | A group the role has nothing in is not shown (a trainer); the groups work in the sidebar sheet at phone width | A-105, AC-23 |
| E2E-151 | A customer's "Emails sent" tab shows each email's status and why a failed one failed, and an empty tab says so (`e2e/customer-emails.spec.ts`; the sender, its retries, and the failure task are in `apps/api/test/integration/mail.int.test.ts`; access, scope, and what the list returns in `e2e/security/mail.spec.ts`) | FR-MAIL-003, A-106 |
| E2E-152 | Admin adds a service, prices it in three tiers (a gap between two), tries 12 sessions (unit price, total, name, end date) and 24 (refused), saves a version from tomorrow that does not change today's price, and sets the quick-pick counts (`e2e/services.spec.ts`; the lookup edges and versions in `apps/api/test/integration/services.int.test.ts`) | FR-SVC-001 to FR-SVC-003, AC-02, AC-10, A-107 to A-109 |
| E2E-153 | The forms refuse a name in use (any case), overlapping tiers, and a past start day | A-107, A-109 |
| E2E-154 | Reception reads services and tries prices but has no button to add or change them (`e2e/services.spec.ts`; roles, branch scope, and input errors in `e2e/security/services.spec.ts`) | D-017, A-109 |
| E2E-155 | Admin adds a promotion and a voucher (a code in use is refused); on a service the price card takes the promotion first, the voucher on what is left, then VAT, and a wrong voucher is refused (`e2e/promotions.spec.ts`; stacking, rounding, and refusals in `apps/api/test/integration/promotions.int.test.ts`) | FR-SVC-004, A-110, A-111 |
| E2E-156 | Admin switches a promotion off and it can no longer be chosen on a price | A-110 |
| E2E-157 | Admin sets the discount a role may approve; it is kept, and over 100 is refused | FR-PLT-002, A-112 |
| E2E-158 | Reception chooses a promotion on a price but has no page to manage them; voucher codes are never listed to staff (`e2e/security/promotions.spec.ts`) | D-017, A-110 |
| E2E-145 | A manager switches a consultant's receiving off and the next lead stays New, on again and it is dealt; the weight is 1 to 20; a consultant has no page for it (`e2e/lead-receivers.branch.spec.ts`) | D-050 |
| E2E-144 | Admin removes a tick with a reason (Khác needs its note) and the step opens again; a consultant has no button; a step past its grace period is Không thực hiện and cannot be ticked, inside it the tick is late (`e2e/checklist-lock.spec.ts`) | D-054 |
| E2E-143 | An employee's direct manager is chosen from the others and shown; the coded catalog's entry is read by its number on a lead (`e2e/organization.spec.ts`) | D-046, D-066 |
| E2E-142 | A lead is added with a name and a channel only; the nationality is a country and the lead shows its name; another consultant's lead says who has it with no way in (`e2e/lead-intake.spec.ts`) | D-057, D-060 |
| E2E-138 | The lead analysis splits the leads by each of the six dimensions, each with a chart and a table, lists the notes of "Khác", and exports to Excel (`e2e/reports.spec.ts`) | brief §9, AC-08 |
| E2E-137 | The consulting dashboard shows the team's figures, the funnel chart, and each consultant's row with the team last, a period without leads shows dashes, and it exports to Excel (`e2e/reports.spec.ts`) | brief §9, AC-08 |
| E2E-136 | A consultant sees the manager's grade, criteria, and comment on their lead and has no button to grade (`e2e/lead-audit.spec.ts`) | A-086 |
| E2E-135 | A manager fails a lead naming the criteria not met and a comment, then passes it: both grades are kept, the latest first; a Fail without a criterion is refused before saving (`e2e/lead-audit.spec.ts`) | FR-LEAD-011, A-086, A-087 |
| E2E-134 | Admin switches a criterion off and weighs another on the criteria page, and a lead's audit score changes at once; a weight outside 1 to 10 is refused before saving (`e2e/lead-audit-criteria.branch.spec.ts`) | A-083, AC-02 |
| E2E-133 | The audit is for managers: a consultant has no menu item, the page is refused, and a lead's page has no audit card (`e2e/lead-audit.spec.ts`) | A-084 |
| E2E-132 | A late step puts the lead in "Leads to check" and lowers its score on the lead's audit card, with the steps' outcomes and the criteria (`e2e/lead-audit.spec.ts`) | FR-LEAD-011, AC-07 |
| E2E-131 | Admin sees Export Excel on all nine lists and each downloads a file with a header row; reception sees none; a Fitness Manager has the six of its modules (`e2e/export.spec.ts`) | A-077 |
| E2E-130 | A list longer than the export limit is refused with a message naming the limit and the count, and no file is downloaded; narrowing the search brings it under (`e2e/export-limit.branch.spec.ts`) | A-078 |
| E2E-129 | The file holds the rows of the customer list for the same search and filters, named after the list and the day (`e2e/export.spec.ts`) | FR-CUS-003, A-079 |
| E2E-128 | A customer who was a lead keeps its consulting history: the note, the timeline, and the checklist on the Consulting history tab (`e2e/customer-profile.spec.ts`) | A-076 |
| E2E-127 | Reception adds the address, emergency contact, and staff in charge in the edit sheet (whose Save button stays reachable on a short screen), and the page shows them (`e2e/customer-profile.spec.ts`) | FR-CUS-001 |
| E2E-126 | Reception filters customers without an email (marked "Chưa có email"), by birthday month and by registration day (`e2e/customer-profile.spec.ts`) | FR-CUS-003, FR-CUS-005 |
| E2E-125 | A consultant adds notes to a lead; they show on the history newest first with the author (`e2e/scripts-notes.spec.ts`) | FR-LEAD-006 |
| E2E-124 | On a phone a consultant copies a script's answer in the lead's language (English for a foreigner, switchable) and the clipboard holds that text; empty scripts are not offered (`e2e/scripts-notes.spec.ts`) | FR-LEAD-010, AC-23 |
| E2E-123 | A manager adds a script, edits it, switches it off, and reorders the library; markup in a script is shown as text, never run (`e2e/scripts-notes.spec.ts`) | FR-LEAD-010 |
| E2E-122 | "Từ chối" on the re-care step asks for the reason and sets the next contact-again day to today + `recareDays` (not the earlier day); refusing again after a return to Consulting sets it again (A-062) (`e2e/recare.spec.ts`) | AC-07 (15-day part) |
| E2E-121 | "Đặt lịch" on the re-care step asks for the appointment, books the lead again (status Booked, appointment shown), the step is done and the pre-visit reminders reappear, one reaching "Việc hôm nay" when due (`e2e/recare.spec.ts`) | AC-07, BR-204 |
| E2E-120 | On a phone a consultant's re-care list holds only No response, Refused, and No show, oldest contact-again day first, overdue marked, nothing wider than the screen; the status and overdue filters narrow it; a manager has none under "Của tôi" and the team's under "Tất cả" (`e2e/recare.spec.ts`) | FR-LEAD-007, AC-23 |
| E2E-119 | A receptionist records Show: the form needs the consent, the lead becomes a customer with a KH code, its ID document, health note, and nationality, and leaves the lead list; on a phone a consultant records No show on the checklist and the lead goes to re-care (`e2e/visit.spec.ts`) | AC-09 (part), AC-23 |
| E2E-118 | On a phone a consultant sees "Đặt lịch" done by the booking, records a visit reminder on time, and completes the Báo Studio step it opens from "Việc hôm nay"; an admin renames a step and saves a new version that only new leads get (`e2e/checklist.spec.ts`) | AC-07, AC-23 |
| E2E-117 | New leads go round-robin to a branch's consultants; an admin reassigns one and records a refusal with its reason; the history and the Kanban board show both; on a phone a consultant sees only their own leads, books an appointment, and finds it on the board (`e2e/leads.branch.spec.ts`) | AC-06, AC-23 |
| E2E-116 | A walk-in is added with the quick form on a phone and on a desktop, gets an LD code and status New; a phone already on a customer offers the merge (E2E-102) (`e2e/leads.spec.ts`) | AC-06 (part), AC-23 |
| E2E-115 | A manager gives a task; the receptionist sees it in the bell, accepts, works on, and completes it; the manager is told; comments with mentions; overdue tasks are marked (`e2e/tasks.spec.ts`) | AC-05 |
| E2E-114 | A manager adds a PT, sets a shift and a day off; the calendar books only inside the shift; a PT sees their own schedule read-only (`e2e/employees.spec.ts`) | AC-02 |

## Concurrency scenarios (integration)

| ID | Scenario |
|---|---|
| INT-001 | 10 parallel "Đã tập" on one session consume once and audit once. |
| INT-002 | Two sessions racing for a contract's last session: exactly one consumes. |
| INT-003 | Two overlapping bookings for one PT at once: one succeeds. |
| INT-004 | The same receipt submitted twice with one key records once. |
| INT-005 | The same key with another amount is refused. |
| INT-006 | A disabled account, or a sign-in outside allowed hours, loses access on the next request. |
| INT-007 | Exclusion constraints for PT and customer overlap exist in the migrated database. |
| INT-008 | Contract expiry at the timezone boundary; no expiry while frozen. |
| INT-009 | Two overlapping bookings for one customer with two PTs at once: one succeeds. |
| INT-010 | Approve and delete of the same pending record at once: one wins, the other gets a clear error. |
| INT-011 | Two payouts for the same period and PT at once: no session paid twice. |
| INT-012 | Reactivating a frozen contract twice at once extends the end date once. |
| INT-013 | Merging the same two records at once (also with the pair in the other order, or five requests): one merge, one trash entry; the others get `PERSON_ALREADY_MERGED`. |
| INT-014 | Two lead intakes with one phone at once: one lead is created, the other gets `DUPLICATE_PHONE`; after a merge one live record holds each phone. |

## Reused from Phases 0–4

The Phases 0–4 suites (unit, integration, E2E, security) remain green until milestone M1 restructures the code; scenarios for superseded rules (check-in step, no-show without consumption) are rewritten in M5 together with the code (`25_BRIEF_V2_GAP_ANALYSIS.md`).

## Quality gates

Before merge: lint, type-check, unit, integration (including INT-001 to INT-012 as their features land), API contract tests. Before a milestone is delivered to staging: the full E2E and security suites, migration on a copy of production data, and the milestone's acceptance criteria.
