# 06 — Functional Requirements

One section per module of phase 1 (`01_SCOPE_MVP.md`). Rules are in `05_BUSINESS_RULES.md`; values are initial configuration (D-015). Every list screen uses the shared template: filters on the left, search, table with paging and a totals row, Add, Export Excel (brief §1).

## Platform (FR-PLT) — brief §1, §2

- **FR-PLT-001** Admin manages user accounts: username, full name, email, linked employee, active status. The detail page has tabs: Information, Permissions, Access hours, Login history.
- **FR-PLT-002** Admin creates, edits, and clones roles; ticks permissions in the tree (module × action); sets data scope, field masks, and discount thresholds per role.
- **FR-PLT-003** Admin switches individual permissions on or off per user, grants branches, and sets allowed login days and times.
- **FR-PLT-004** Admin manages branches.
- **FR-PLT-005** Admin manages option lists: add, edit, reorder, deactivate options; each list has "Khác"; a report shows "Khác" entries to promote.
- **FR-PLT-006** Admin manages system parameters (timers, thresholds, calendar hours, cut-offs), session status rules and colors, code prefixes, and the approval matrix.
- **FR-PLT-007** Submissions under the approval matrix stay pending, create an approver task, and take effect only when approved; rejection takes a reason; self-approval is refused; overdue requests remind.
- **FR-PLT-008** Every change is recorded in the action history with before and after values; admins search it by user, entity, and date.
- **FR-PLT-009** Users receive in-app notifications (assignments, deadlines, overdue, comments, approvals, escalations).

## Employees (FR-EMP) — brief §8.4

- **FR-EMP-001** Manage employees: code, name, birth date, gender, phone, email, ID document, department, team, title, branch, working status; each linked to one account.
- **FR-EMP-002** Manage PT working schedules (shifts and days off); they define bookable cells.

## Trash (FR-TRASH) — brief §8.5

- **FR-TRASH-001** Deleting a business record asks for a reason and moves it to the trash with who and when.
- **FR-TRASH-002** Authorized users view and search the trash at any time; nobody can purge or restore by editing. Re-creating is done as a new record.

## Leads and consulting (FR-LEAD) — brief §3, §4.1

- **FR-LEAD-001** Quick form for walk-ins and unintegrated channels; channel APIs feed the same intake later (D-044).
- **FR-LEAD-002** Lead profile: date, PIC, name, gender, birth date, phone, email, channel, source with Organic/Paid and detail, nationality group, need group and coded need detail with note, pain status, assessment type, appointment status and time, Show / No show, notes.
- **FR-LEAD-003** New leads are assigned round-robin to active consultants of the branch; managers reassign; manager notified of new leads, consultant notified when assigned.
- **FR-LEAD-004** Each lead has the consulting checklist; due steps create tasks; results are drop-downs; steps are marked on time, late, or skipped.
- **FR-LEAD-005** "Today's tasks" per consultant shows due and overdue steps.
- **FR-LEAD-006** List and Kanban by status; lead detail with checklist, timeline, notes, and appointments.
- **FR-LEAD-007** Re-care list sorted by contact-again date. Built (M2 slice 5): filters status, consultant, overdue; mine or all; phone-friendly.
- **FR-LEAD-008** "Convert to customer" at Show requires ID document, birth date, nationality, and email; the record keeps its ID.
- **FR-LEAD-009** Duplicate phone warning with merge. Built (M2 slice 5): inquiry on the existing record, and a manager's merge of two records.
- **FR-LEAD-010** Script library: situations with Vietnamese and English answers; copy button; managed by managers.
- **FR-LEAD-011** Automatic audit per lead and consultant (compliance %, late and skipped steps, missing required fields); manager audit with pass/fail and comment.
- **FR-LEAD-012** AI-assisted audit suggestions (milestone 11, OQ-025).

## Customers (FR-CUS) — brief §4.2

- **FR-CUS-001** Profile: code, name, phone, email (required), birth date, gender, nationality, documents, address, basic health, customer group, channel, source, emergency contact, staff in charge, branch, notes, consent.
- **FR-CUS-002** Derived status (training, expiring soon, expired, on hold, no contract).
- **FR-CUS-003** Filters: branch, staff in charge, registration date, birthday, end date, status. Search by code, name, phone.
- **FR-CUS-004** Detail tabs: Information, Contracts and services, Payment history, Workout plans, Session logs and progress, Consulting history, Emails sent.
- **FR-CUS-005** Customers without email are highlighted for reception.

## Services and prices (FR-SVC) — brief §5.1

- **FR-SVC-001** Manage services: name, image, kind (PT, class, member), branches, allowed hours, commission rate, group package and max members, limits per week and per day, validity, notes.
- **FR-SVC-002** Manage price tiers per service (session range, unit price, validity months and days) with versions and effective dates; admin only.
- **FR-SVC-003** Quick-pick packages per service.
- **FR-SVC-004** Promotions and vouchers (percent or amount, dates).

## Contracts (FR-CON) — brief §5.2–§5.5

- **FR-CON-001** Create a contract for a customer: branch, date, generated code, service type, service, contract type (New/Renew), companions, notes; sessions, months, days; activation deadline, start, planned start, computed end; previous contract when renewing; PT and Sale staff with shares; signature; price computed from the tier, promotion or voucher, discounts, VAT, bonus months/days/sessions; first payment (creates a receipt), receipt salesperson, due date for the rest.
- **FR-CON-002** Enter any session count; unit price, total, end date, and name are computed; an exception price takes a reason and is flagged for approval.
- **FR-CON-003** Approve or reject (reason) pending contracts; edit only while pending.
- **FR-CON-004** List with code, customer, date, branch, type, service, status, unit price, total, paid, debt, start, end, sessions total/used/left, and totals of value, paid, and debt for the filter. Filters: branch, type, date, service, PT, promotion, payment status, signature status, approval status.
- **FR-CON-005** Detail tabs: Information, Check-in history (date, time, status, slot, PT, confirmation method, note), Package history (change vouchers, freezes, changes).
- **FR-CON-006** Actions, each a permission: Pay (receipt), Print, Update note, Deactivate, Unapprove, Delete.
- **FR-CON-007** Delete with reason; blocked while receipts, sessions, or change vouchers exist, listing them.
- **FR-CON-008** Deactivate and reactivate with reasons; reactivation shows the old and proposed end dates; admin chooses; reminder after 10 days.

## Change vouchers (FR-CHG) — brief §5.6

- **FR-CHG-001** Create, approve, and list renewal, upgrade, hold, transfer, branch transfer, conversion, and cancellation vouchers with their own fields; each linked to the original contract.
- **FR-CHG-002** An approved voucher updates the derived figures (sessions, dates, value); cancellation creates the refund expense voucher.

## PT schedule and sessions (FR-PT) — brief §6.1–§6.3, §6.5

- **FR-PT-001** Day grid with one row per PT, 30-minute cells, configurable hours; back, today, forward, and week view; filters: branch, date, PT, customer; count of sessions per PT; bookable cells green, others grey; works on phones.
- **FR-PT-002** Book: customer, contract with sessions left, start, duration; refused per BR-402/BR-403.
- **FR-PT-003** Session detail: PT, member (code, name, phone), contract, service, start, end, status, note, actions (Đã tập, Hủy lịch, Khách không đến, Delete, Close); opening the session log from the session.
- **FR-PT-004** Admin confirms many sessions of a day quickly ("Đã tập" in bulk).
- **FR-PT-005** Delete a recorded session from the contract's check-in history (reason, refund, email, adjustment).
- **FR-PT-006** Burn Show: add a session by hand (branch, date, check-in and check-out time, member, PT, reason).
- **FR-PT-007** PT revenue allocation report (D-032), filters period, PT, branch, totals per PT, Excel export in GymMaster's column order.

## Classes (FR-CLS) — brief §6.4

- **FR-CLS-001** Manage classes (name, coach, branch, slot, capacity, weekly recurrence).
- **FR-CLS-002** Class grid by day and week.
- **FR-CLS-003** Enroll customers (and drop-ins); refused when full or the contract is out of sessions or expired.
- **FR-CLS-004** Attendance present/absent; present consumes one session.

## Workout plans and logs (FR-WKO) — brief §7

- **FR-WKO-001** Catalogs: equipment, body areas (tree), exercises (Strength/Cardio, video), stages, plan templates.
- **FR-WKO-002** Customer plans from a template or from scratch, by week and session, with stages, exercises, and set targets.
- **FR-WKO-003** Three-part session log with plan and actual on one row per set; quick entry on phones (defaults from the plan).
- **FR-WKO-004** Flags and Actions per set; "Stop + Escalation" notifies manager and Master and creates a task.
- **FR-WKO-005** Progress in the customer profile: sessions done vs planned, current phase and stage, trends per exercise, stress, energy, sRPE, Flag and Action history.

## Cash book (FR-CASH) — brief §8.1

- **FR-CASH-001** Receipts: number, date, customer, contract or change voucher, amount, method, collector, salesperson, branch, note, transfer proof image.
- **FR-CASH-002** Expense vouchers: number, date, expense type, payee, amount, method, payer, branch, note; refunds linked to contracts.
- **FR-CASH-003** PT payouts from the allocation report of a period; adjustments applied.
- **FR-CASH-004** Edit receipt date (permission, logged); delete vouchers to the trash with reason.
- **FR-CASH-005** Cash book by day and period (opening, in, out, closing) per method and branch; income and expense report; member debt report; Excel export.

## Tasks (FR-TASK) — brief §8.2

- **FR-TASK-001** Create a task: title, description, assignee (person or department), deadline, priority, link to a lead, customer, contract, or session.
- **FR-TASK-002** Statuses New, Accepted, In progress, Done, Cancelled; the assignee accepts.
- **FR-TASK-003** Comments with mentions.
- **FR-TASK-004** System-generated tasks (Báo Studio, escalations, approvals, long freezes, failed emails).
- **FR-TASK-005** Views: my tasks, tasks I assigned, by department; filters by status and deadline; overdue highlighted and reported to the assigner.
- **FR-TASK-006** Report: assigned, done on time, late, per person and department.

## Customer email (FR-MAIL) — brief §8.3

- **FR-MAIL-001** Admin edits templates per event in Vietnamese and English and toggles optional events.
- **FR-MAIL-002** Emails on credited and refunded sessions with sessions used and left (and the reason for refunds).
- **FR-MAIL-003** Each email is stored on the customer with status; failures create a reception task.

## Reports (FR-RPT) — brief §9

- **FR-RPT-001** The dashboards and reports of `10_REPORTING_DASHBOARD.md`, each its own permission, filtered by branch, period, and staff, with Excel export.

## Import (FR-IMP) — brief §11

- **FR-IMP-001** Import GymMaster exports and the consulting Excel into staging and production, keeping legacy codes, with a cleanup list for the owner and a reconciliation report (D-039).
