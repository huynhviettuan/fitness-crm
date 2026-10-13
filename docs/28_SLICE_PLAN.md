# 28 — Slice Plan

What is left to build in phase 1, cut into vertical slices, in the order they will be built. Milestones and progress: `16_IMPLEMENTATION_PLAN.md`; effort: `27_ESTIMATES.md`; what is reused and reworked: `25_BRIEF_V2_GAP_ANALYSIS.md`.

This plan is written before the work and refined at the start of each slice. A slice is done only when it meets `AGENTS.md` §7. When a slice turns out bigger than one sitting, it is split here first, not left half done.

## How to read a slice

Each slice lists:

- **Builds** — the behavior, in the brief's terms.
- **Source** — brief sections, FR, BR, decisions; the acceptance criteria (doc 14) it moves forward.
- **Data / API / Web** — tables, endpoints, and screens it adds or changes.
- **Tests** — the scenarios (doc 13) to write.
- **Decide first** — rules the brief does not settle. Each becomes an A-entry (or an OQ when it can change money, sessions, PT pay, or permissions) in doc 18 before coding. Interim behavior only for an open OQ.
- **Depends on** — slices that must be done first.

## Plan-level decisions

| # | Topic | Proposal | Why |
|---|---|---|---|
| P-1 | The consulting-Excel import | Move it from M9 to M3 (slice M3.5) | AC-08 compares the consulting dashboard with the Excel files of September and October 2026, so those leads have to be in the system when M3 is accepted. |
| P-2 | Excel export | Build one shared export in M3.1 and add it to every existing list | The brief asks for Export Excel on every list (§1) and every report (§9); none exists yet. Every later list and report reuses it, and AC-01 checks that masked fields never reach a file. |
| P-3 | File storage | Build signed-URL storage (Cloudflare R2, T-052) in M4.1, where the first files appear (service images), before receipt proofs (M4.5) | One owner for files; no file is served without a signed URL. |
| P-4 | Staging | Set up staging (doc 15) before the owner's M2 trial | Every milestone ends on staging (doc 16), and M1 is still waiting for it. |
| P-5 | Customer email before M6 | M5's credited and refunded sessions write an email event into the outbox table created in M5.4; M6 sends them | AC-17 needs one email per change, including changes made between M5 and M6. **Superseded by P-6.** |
| P-6 | Email infrastructure first | M6 becomes "automatic email infrastructure" (D-059); M6.1 is built at the start of M4 as M4.0, and each later feature attaches its event as it is built | The owner's answer of 12/10/2026: every action that changes a customer's entitlements emails them, and nothing should be wired back later. |
| P-7 | Customer feedback follow-up | A slice M2.7 changes what M1 and M2 built (lead form, nationality, weighted assignment, reclaim, checklist lock, reminders, organization), before M3.5 and M4 | The answers of 12/10/2026 reverse or extend decisions already built; the later the change, the more it costs. |
| P-8 | Staff notifications | Email and phone push for staff are slice M6.4, after the sender exists (M4.0) | D-053 needs the infrastructure of D-059. |
| P-9 | Fingerprint-ready check-in | The scan API, the pairing, and the machine data are slice M5.3b; the NextFace ID survey (TS-009) is answered before M5 starts | The updated brief of 12/10/2026 (§6.6, D-069 to D-072) asks for no rework when a machine is attached. |

## M2 — Leads and consulting (remaining)

### M2.5 Re-care queue and duplicate merge (done 2026-10-12)

- **Builds:** "Danh sách tái chăm sóc", sorted by contact-again day, with filters (status No response / Refused / No show, consultant, overdue) and scope mine/all. The re-care step's results do something: "Đặt lịch" asks for the appointment and books the lead again, which starts the pre-visit steps again; "Từ chối" asks for the reason and sets the next contact-again day. A phone that already belongs to a person no longer only blocks the quick form: it offers to merge. The new inquiry's channel, source, need, and note go onto the existing record as a new inquiry on its timeline. A lead in re-care goes back to the consultant, and the consultant and manager are notified. Managers can also merge two existing records of one person.
- **Source:** brief §3 (flow rules, duplicate phones), §4.1 step 10 and screens; FR-LEAD-007, FR-LEAD-009; BR-202, BR-204; D-019; AC-07 (the 15-day part), AC-03.
- **Data:** `lead_inquiries` (one row per intake on a person), `person_merges` (survivor, merged record, who, why). The merged record goes to the trash with its reason, and its codes are never reused.
- **API:** `GET /leads/recare`; `POST /leads/intake` answers `DUPLICATE_PHONE` with the existing person, and `POST /leads/:id/inquiries` adds the inquiry; `POST /persons/:id/merge` needs the new permission `lead.merge`.
- **Web:** a re-care page in the leads nav; a merge dialog on the quick form; a merge action on the lead and customer pages; the inquiries on the timeline.
- **Tests:** E2E-102 (duplicate phone, then warning, merge, one record); the re-care list order and filters on a phone; the re-care "Đặt lịch" result books the lead again, and its pre-visit steps appear in "Việc hôm nay". Integration: a merge moves every child row and audits it, and two concurrent merges of the same pair act once. Security: who may merge, and scope (a consultant can't merge another consultant's lead).
- **Decide first:**
  - Does re-care repeat after a second refusal (proposed: yes, every `recareDays`)?
  - Is a returning person reassigned or kept with their consultant (proposed: kept while that consultant is active, otherwise round-robin)?
  - Which record survives a merge (proposed: the older one, which keeps its codes)?
- **Depends on:** M2.4.

### M2.6 Script library, lead notes, and customer profile (done 2026-10-12)

- **Builds:**
  - **Script library:** situations with Vietnamese and English answers, managed by managers. On a lead, a side panel picks a situation and copies the answer in the customer's language. The 12 situation names from the brief are seeded; the answers come from the owner's "Framework tư vấn chung" sheet, entered on screen.
  - **Lead notes:** dated, with the author, and shown on the timeline.
  - **Customer profile per §4.2:** address, customer group (option list), emergency contact, staff in charge, and notes. Filters: branch, staff in charge, registration date, birthday month. Customers without email are highlighted. The detail page gets an Information tab and a Consulting history tab (timeline and checklist from the lead). The other tabs arrive with their modules.
- **Source:** brief §4.1 (scripts, screens), §4.2; FR-LEAD-006, FR-LEAD-010, FR-CUS-001, FR-CUS-003, FR-CUS-004 (part), FR-CUS-005.
- **Data:** `consulting_scripts` (situation, VI, EN, active, order); `lead_notes`; new customer columns; option list `customerGroups`.
- **API:** `/consulting-scripts` CRUD (`script.manage`), `GET /consulting-scripts?active`; `/leads/:id/notes`; customer filters.
- **Web:** admin page "Kịch bản tư vấn"; the script panel on the lead (copy button, phone width); customer list filters; customer tabs.
- **Tests:** a manager adds a script, a consultant copies it on a phone, and the clipboard holds the right language. A consultant adds a note and sees it on the timeline. Reception filters customers without email. Security: masking of the address and emergency contact; script management permission.
- **Decide first:**
  - Is the address hideable like phone and email (brief §2 lists the address: yes)?
  - Which customer groups are seeded (proposed: none besides "Khác" until the owner gives them)?
- **Depends on:** M2.5.

**M2 close:** the owner trial on staging for AC-03, AC-06, AC-07, AC-09 (lead part), and AC-23 (leads).

### M2.7 Customer feedback follow-up (done 2026-10-12, from the answers of 12/10/2026)

What the owner's answers change in what M1 and M2 already built. All numbers are parameters (D-015).

- **Builds:**
  - **Lead form:** only name and channel are required; the duplicate check runs only with a phone; a consultant can open the old profile of a returning person, within their permissions, instead of only being refused (D-060).
  - **Nationality:** a list of ISO 3166 countries; the group (Việt Nam or Nước ngoài) and the email language are derived; old data with only "Nước ngoài" keeps the country empty and flagged for completion; the lead analysis can split by country (D-057).
  - **Weighted assignment:** a turn weight per consultant (initially 1) and a receiving on/off switch; only people within their working hours get leads; the rule set takes new conditions without a rewrite (D-050).
  - **Reclaim:** an untouched lead moves to the next consultant after 1 hour counted inside 08:30–20:30; each move is recorded, the previous owner is told, and the consulting dashboard reports moves per person and period (D-052).
  - **Checklist lock:** a tick cannot be removed except by admin with a reason; an overdue step locks as "Không thực hiện" after a grace period; a tick in the grace period is "Trễ"; the system writes the tick time; the dashboard gets each step's completion rate and its relation to booking, show, and contract rates (D-054, D-055).
  - **Reminders:** a list of points per task, initially 24 h, 3 h, and 1 h; admin edits the shared points and the assigner edits one task's (D-056).
  - **Organization:** the "Quản lý trực tiếp" field; departments, job titles, and reporting lines seeded from the org chart; the title → role mapping; slow approvals told to the direct manager, else Admin; task assignment grants (D-046, D-047, D-048).
  - **Need details:** a coded catalog with a note field (D-066).
  - **Master:** stays with Admin (D-049).
- **Source:** the owner's answers of 12/10/2026; D-046 to D-072; AC-03, AC-06, AC-07.
- **Data:** employee direct manager; department and title catalogs with codes; consultant turn weight and receiving flag; lead moves; checklist locking fields and parameters; reminder points; the countries list.
- **Tests:** unit for the weighted turn, the working-window clock (the 20:00 lead has 30 minutes, then 30 more at 08:30), the locked step states, and the group derived from the country; integration for each rule; E2E for the lead form and for admin removing a tick; security for who removes a tick and who switches receiving.
- **Decide first:** the grace period default and the reclaim hours go to parameters with the owner's numbers (1 hour, 08:30–20:30); nothing else is open.
- **Depends on:** M2.6.

## M3 — Audit and consulting dashboard

### M3.1 Excel export (P-2) (done 2026-10-12)

- **Builds:** one shared export owner. Each list and report declares its columns once; the API streams `.xlsx` with the same filters, scope, and masks as the screen. The export permission is checked per list. Exports are audited (who, what, filters). Every existing list (users, customers, leads, contracts, payments, cash, tasks, history, trash) gets the Export button.
- **Source:** brief §1 (list template), §2 (export is a sensitive permission), §9; D-017, D-041; AC-01 (export part).
- **API:** `GET /<list>/export` with the list's query schema; one writer service.
- **Tests:** E2E-112 (masked phone absent from the file). Integration: the export row count equals the list total for the same filters, and a role without export gets 403.
- **Decide first:** the export row limit (proposed: a parameter, 50,000 by default).
- **Depends on:** —

### M3.2 Rule-based consulting audit (done 2026-10-12)

- **Builds:**
  - Compliance per lead and per consultant: on-time steps divided by due steps, with late and skipped counted.
  - Flags for leads missing required fields: need group, phone, refusal reason. The criteria come from configuration.
  - An Audit tab on the lead and a "Leads to check" list per consultant.
- **Source:** brief §4.1 (audit); FR-LEAD-011 (automatic part); AC-07 (late steps count in the audit).
- **Data:** `audit_criteria` (configurable required fields and weights); compliance is computed from `lead_steps`, not stored.
- **Tests:** a late step lowers the score; a refused lead without a reason is flagged; deactivating a criterion changes the score immediately.
- **Decide first:** the score formula (proposed: share of due steps done on time; skipped steps count as missed).
- **Depends on:** M2.6.

### M3.3 Manager audit (done 2026-10-12)

- **Builds:** a manager opens a lead with its full timeline and marks it pass or fail. The decision has a comment and the failed criteria, taken from an option list. A queue lists each consultant's leads not yet audited. The audit score appears on the lead.
- **Source:** brief §4.1 (manager audit), §10 (Audit tư vấn); FR-LEAD-011.
- **Data:** `consulting_audits` (lead, auditor, result, criteria, comment, at), audited.
- **API:** `/leads/:id/audits` (`lead.audit`).
- **Tests:** a manager audits a lead, and the consultant sees the result but can't audit. Scope: the manager sees only their branches.
- **Decide first:** can a lead be audited more than once (proposed: yes, and the latest counts)?
- **Depends on:** M3.2.

### M3.4 Consulting dashboard and lead analysis (done 2026-10-12)

- **Builds:**
  - **Consulting dashboard**, per consultant and for the team:
    - leads received;
    - the funnel Lead → Consulted → Booked → Show → Contracted (contracted counts approved contracts once M4 lands);
    - show rate and on-time compliance;
    - time to first response;
    - re-care results and audit score.
  - **Lead analysis** by channel, source, Organic/Paid, need group, nationality group, and refusal reason, plus the "Khác" entries of each list (FR-PLT-005).
  - Charts use one shared chart component (shadcn chart). Both pages filter by branch, period, and staff, export to Excel, and each is its own permission.
- **Source:** brief §9; doc 10; FR-RPT-001; AC-08.
- **Tests:** a fixed dataset with known counts per consultant, checked in integration against the queries and in E2E on the page; masking for Marketing (no phones).
- **Decide first:**
  - The definitions of "Consulted" (proposed: the first step-1 result) and "first response" (proposed: from assignment to the first step done).
  - Whether to count by the lead's created date or by the event date (proposed: cohort by created date, which is what the Excel does).
- **Depends on:** M3.1, M3.3.

### M3.5 Consulting-Excel import (P-1)

- **Builds:** a staging-first importer for "CRM Flow Fitness - MKT". It maps the columns to lead fields, option lists, and statuses (Booking Status keeps its 5 values). The dry run lists unmapped values and duplicate phones. Imported leads keep their dates so the dashboard can be reconciled with September and October 2026.
- **Source:** brief §11 (migration), §12; D-039; AC-08.
- **Tests:** a small anonymized sample file imports idempotently, and the dashboard counts equal the counts computed from the file.
- **Decide first:** the owner sends an anonymized copy of the file (brief §1 asks to remove real names and phones); OQ-014 for production.
- **Depends on:** M3.4.

**M3 close:** reconcile AC-08 with the owner on staging.

## M4 — Contracts and cash book

### M4.0 Email infrastructure (M6.1, moved here by P-6; built 2026-10-12, A-106)

The sender, the outbox, the failure task, and the domain setup of M6.1 are built before M4.1, so every feature of M4, M5, and M8 attaches its email when it is built (D-059). **Built:** the `email_messages` outbox, `queueEmail` for the features, the pg-boss `mail` worker with Resend and a log provider, retries, the task for reception, and the customer's "Emails sent" tab. **Left for the owner:** the sending domain, its DNS records, and the sender name (OQ-036). The approval matrix is switched on for creating and editing contracts, exception prices, deactivation, and change vouchers as each of them is built (D-065).

### M4.1 Services, price tiers, and file storage (split: M4.1a built 2026-10-12, A-107 to A-109; M4.1b remains)

M4.1a is the services, the price tiers in versions, the quick-pick packages, the lookup, and the admin screens. M4.1b is **file storage on R2 with signed URLs and the service image**; it comes next, before receipt proofs (M4.5), and needs the R2 bucket and keys from the owner's side (no package is added: the signing is done with the Node crypto module).

- **Builds:**
  - **Services:** kind (PT, Class, Member), branches, allowed hours, commission rate, group package and maximum members, limits per week and per day, validity, image.
  - **Price tiers per service:** session range, unit price, and validity in months and days. They are versioned with effective dates, and only admin edits them.
  - **Quick-pick packages.**
  - **Tier lookup:** gives the unit price, total, end date, and display name ("Hybrid Training 30 buổi").
  - **File storage on R2 with signed URLs (P-3).**
- **Source:** brief §5.1; FR-SVC-001 to FR-SVC-003; D-021; T-052; AC-02 (tiers), AC-10 (lookup).
- **Data:** `services`, `service_branches`, `price_tier_versions`, `price_tiers`, `quick_packages`, `files`.
- **Tests:** unit tests for the lookup (range edges, gaps, version by date); E2E for admin editing a tier, where a new version applies to new contracts only; security for who edits tiers and for signed URLs that expire and are scoped.
- **Decided (working assumptions):** a count that falls in no tier is refused (A-107); an end date counts the start day (A-108, to check with one real contract, OQ-037).
- **Depends on:** —

### M4.2 Promotions and approval thresholds (done 2026-10-12, A-110 to A-112, OQ-038)

- **Builds:**
  - **Promotions and vouchers:** a percent or an amount off, dates, and services. They apply to the tier price and are not an exception price.
  - **Discount thresholds per role:** the most a role may discount without approval, and who approves above it (brief §2).
- **Source:** brief §2 (thresholds), §5.1; FR-SVC-004; FR-PLT-002.
- **Tests:** a promotion outside its dates isn't offered. A discount above the role's threshold goes to approval, and one below doesn't.
- **Decided (working assumptions):** one promotion and one voucher stack, promotion first (A-110); VAT after discounts (A-111); the discount limit is a percent of the tier price per role and escalates above it (A-112). M4.4 calls `canApproveDiscount` when a contract is approved.
- **Depends on:** M4.1.

### M4.3 Contract model and creation (done 2026-10-12, A-113 to A-119, OQ-039, OQ-040)

- **Builds:**
  - **New contract model:**
    - statuses Pending, Active, Frozen, On hold, Expired, Cancelled;
    - type New or Renew, linked to the previous contract;
    - sessions, months, and days; bonus sessions, months, and days kept separate;
    - activation deadline, start and planned start, computed end;
    - PT and Sale splits that total 100%;
    - signature fields;
    - price from the tier, the promotion or voucher, discounts, VAT;
    - an exception price with a reason from an option list;
    - a first payment that creates a pending receipt.
  - **Idempotency key** on create.
  - **Existing contracts migrate** as approved, with their value as an exception price flagged "imported".
- **Source:** brief §5.1–§5.2; FR-CON-001, FR-CON-002; D-021, D-022; T-015; AC-10.
- **Data:** a rework of `contracts`; `contract_staff_shares`. The migration is checked on the dev-DB copy with real Phase 0–4 data.
- **Tests:** E2E-104 (any session count gives the tier price, end date, and name; an exception price stays pending). INT-004 and INT-005 (idempotency).
- **Decided (working assumptions):** the creator needs the customer in their scope (A-117); rounding is whole VND, half up, at each step (A-118). Statuses Frozen and On hold arrive with M4.6 and M8; "Pending" keeps its stored name `DRAFT`.
- **Depends on:** M4.2.

### M4.4 Approval, lock, contract list and detail (built as M4.4a and M4.4b)

- **M4.4a (done 2026-10-14, A-120 to A-125, OQ-041, OQ-042):** the approval, rejection, lead status, the lock (service and database trigger), unapprove, and delete.
- **M4.4b (done 2026-10-14, A-126 to A-128, OQ-043):** the list with every §5.3 column, the totals of the filter and the filters, the detail tabs (Information, Check-in history, Package history), Print, and Update note.

- **Builds:**
  - **Approval:** approve or reject with a reason through the approval engine, and the creator can't approve. An approved contract is locked: an edit is refused in the service and by a database trigger, even for admin.
  - **Lead status** turns to "Đã ký hợp đồng" at the first approval.
  - **List:** every column of §5.3, a totals row, and filters.
  - **Detail tabs:** Information, Check-in history (the current sessions), and Package history.
  - **Actions, each its own permission:** Pay, Print (a print view), Update note, Unapprove, Delete.
- **Source:** brief §5.2–§5.4; FR-CON-003 to FR-CON-006; D-018, D-022; AC-05, AC-11.
- **Tests:** E2E-105 (admin can't edit an approved contract); a contract that isn't approved can't be booked (AC-11); INT-010.
- **Decide first:** what "Hủy duyệt" (unapprove) is allowed to do on a contract with receipts or sessions (proposed: only with none; it returns to Pending). This is permission-sensitive, so it goes to the owner as an OQ.
- **Depends on:** M4.3.

### M4.5 Receipts, expense vouchers, deletion order (done 2026-10-14 except the transfer proof image: A-129 to A-132, OQ-044)

- **Builds:**
  - **Receipts** replace payments: approval, method, collector, salesperson, a transfer proof image, and a date edit that needs its own permission.
  - **Expense vouchers** with configurable types.
  - **Derived figures:** paid, debt, and payment status come only from valid receipts.
  - **Contract deletion** is refused while receipts, sessions, or change vouchers exist, and lists them. Everything is deleted to the trash, and numbers are never reused.
  - **Derived customer status** (D-040) and the customer tabs Contracts and Payment history.
- **Source:** brief §5.4, §8.1; FR-CASH-001, FR-CASH-002, FR-CASH-004, FR-CON-007, FR-CUS-002; D-034, D-035, D-040; OQ-003 interim; AC-12, AC-13, AC-19.
- **Tests:** E2E-106 (the contract part); E2E-110; integration for debt always equal to valid receipts; INT-004 and INT-005 for receipts.
- **Decide first:** do voided payments migrate as deleted receipts with their reason (gap analysis: yes)?
- **Depends on:** M4.4.

### M4.6 Freeze and reactivation; expiry (done 2026-10-14: A-133 to A-137, OQ-045; expiry stays derived, so no nightly job)

- **Builds:**
  - **Deactivate** with a reason. While frozen, the contract can't be booked or checked in, and its future bookings are highlighted.
  - **Reactivate** with a reason. The dialog shows the frozen days and the proposed end date; admin adds them all, edits the number of days, or adds none. The end date changes once per freeze, also under concurrent requests.
  - **A reminder task** when a freeze passes 10 days (parameter).
  - **Expiry:** a nightly job in the gym timezone, which never expires a frozen contract.
- **Source:** brief §5.5; FR-CON-008; D-023; AC-14.
- **Tests:** E2E-107; INT-008; INT-012; the reminder job at a fixed clock.
- **Depends on:** M4.5.

### M4.7 Cash book and contract reports

- **Builds:**
  - **Cash book** per day and per period: opening, in, out, and closing, per method and branch.
  - **Income and expense report** and **member debt report**.
  - **Contract report:** revenue, debt, new and renewed, expiring or running out, grouped by service and tier band.
  - **Exception-price report.**
  - All of them export to Excel, and each is a permission.
- **Source:** brief §8.1, §9; FR-CASH-005; doc 10; AC-19.
- **Tests:** closing = opening + in − out across days and branches; pending and deleted vouchers are excluded.
- **Decide first:** the opening balance of the first day (proposed: an admin entry per method and branch, audited).
- **Depends on:** M4.6.

**M4 close:** AC-02, AC-05, AC-09 to AC-14, and AC-19 on staging.

## M5 — PT schedule, classes, sessions

### M5.1 Configurable session statuses

- **Builds:**
  - **Status rules:** consumes a session, credits the PT, color, and locked once set. They are seeded from the brief's table and edited on screen.
  - **Snapshot:** each session stores the flags of the rule applied when its status was set.
  - **Cancel cut-off parameter,** off by default.
  - **Migration:** BOOKED, CHECKED_IN, and COMPLETED turn into the new statuses.
  - **StatusBadge** reads the configured color.
- **Source:** brief §6.2; D-025, D-029; T-050; AC-02, AC-15 (colors).
- **Tests:** a changed rule affects new status changes only; the colors on the grid follow the configuration.
- **Depends on:** M4.7.

### M5.2 PT grid and booking

- **Builds:**
  - **Grid:** a row per PT, 30-minute cells, configurable hours, and day and week views. Filters: branch, date, PT, customer. Each PT shows a count; every cell can be booked (D-058), and cells inside the on-duty shift are colored differently from cells outside it.
  - **Phone first.**
  - **On-duty shifts (D-058):** a shift is only shown and reported, never a limit; a new PT with no shift can be booked; the PT report counts sessions taught in and outside the shift.
  - **Booking:** customer, a contract with sessions left, start, duration. It is refused when the contract isn't approved, is frozen or expired, or has no sessions left. It is also refused for trainer or customer overlap, or outside the service's hours and weekly or daily limits.
- **Source:** brief §6.1; FR-PT-001, FR-PT-002; D-030; BR-402, BR-403; OQ-001 and OQ-008 interim; AC-15 (refusals), AC-23.
- **Data:** a customer-overlap exclusion constraint.
- **Tests:** INT-003, INT-007, INT-009; E2E on a phone: book, then get refused for an overlap.
- **Depends on:** M5.1.

### M5.3 Session detail, check-in, bulk "Đã tập"

- **Builds:**
  - **Session dialog** with Đã tập (its own permission, admin by default, locked after), Hủy lịch, Khách không đến, Xóa (a booked session only; to the trash with a reason), and Close.
  - **Bulk "Đã tập"** for a day.
  - **Confirmation method,** so the API is ready for devices.
  - **Contract figures:** sessions used and left come only from sessions.
- **Source:** brief §6.2; FR-PT-003, FR-PT-004; D-026; AC-15, AC-16 (lock).
- **Tests:** E2E-108; INT-001, INT-002.
- **Depends on:** M5.2.

### M5.3b Fingerprint-ready check-in (scan API and pairing)

- **Builds:**
  - **One event:** "session confirmed" is the only path to *Đã tập*; the admin's manual confirmation, bulk "Đã tập", and a paired scan all raise it, and it takes the session off the contract, credits the PT, emails the customer, and writes the log (D-069).
  - **Machines and scans:** `POST` for a registered machine with its own key, a machine per branch, a raw scan table with the pairing result, offline scans paired by their real time, a warning when a clock is off (D-072).
  - **The machine user code** on the customer and the employee; no fingerprint or face image is stored; the old codes arrive with the GymMaster import (M9).
  - **Pairing** by the rules of D-070: 15 minutes to wait, the ±1 hour window, one pair per session, 2–3 sessions a day with different PTs, the nearest unconfirmed booking when several fit, repeat scans counted once.
  - **Hanging sessions and errors:** "Thiếu check-in của PT" and "Thiếu check-in của khách"; an error list for scans with no booking or on a contract with no sessions left, expired, or on hold; the PT's end-of-day list with the drop-down choices; after 24 hours a task and a notice to the Studio Manager (D-071); a report of the sessions confirmed by hand, per PT and per customer.
- **Source:** brief §6.6; D-069 to D-072; AC-29, AC-30; OQ-027 and TS-009.
- **Data:** `checkin_devices`, `checkin_scans`, the machine user code columns, a confirmation method "device", the hanging reason.
- **Tests:** unit for the pairing (every row of the table of D-070, and its edges: exactly 15 minutes, exactly 1 hour); integration for the one event (a paired scan and a manual confirmation consume once, also when repeated or concurrent); E2E for the error list and the PT's list on a phone; security for a machine key (an unknown or another branch's machine is refused, a key is never logged).
- **Decide first:** nothing blocks (OQ-027 only blocks attaching a machine); the survey TS-009 is answered before M5 starts.
- **Depends on:** M5.3; the notices to the PT and the Studio Manager use the in-app channel until M6.4 adds email and push.

### M5.4 Delete from check-in history and Burn Show; email outbox

> The outbox and the sender are built earlier, in M6.1 at the start of M4 (P-6); this slice only writes the refund event into them.

- **Builds:**
  - **Delete a recorded session** with a reason: 1 session refunded, the PT credit removed, the session to the trash.
  - **Burn Show:** a session added by hand with branch, date, check-in and check-out times, member, PT, and a reason. It is marked "added by hand", consumes a session, and credits the PT.
  - **Outbox (P-5):** every credited or refunded session writes one email event; nothing is sent until M6.
- **Source:** brief §6.3; FR-PT-005, FR-PT-006; D-026, D-027, D-036; AC-16.
- **Data:** `email_outbox`, with a unique key per session event.
- **Tests:** E2E-109 (without the email delivery); integration for exactly one outbox event per change under concurrent requests.
- **Depends on:** M5.3.

### M5.5 Class schedule and attendance

- **Builds:**
  - **Classes:** coach, branch, time slot, capacity, weekly recurrence. Sessions are generated ahead of time.
  - **Grid** by day and week.
  - **Enrollment** is refused when the class is full or the group contract is out of sessions or expired.
  - **Attendance:** present consumes 1 session; the coach gets a teaching session.
- **Source:** brief §6.4; FR-CLS-001 to FR-CLS-004; OQ-021 interim.
- **Tests:** a full class refuses; attendance consumes once under concurrent requests; a class on the grid at phone width.
- **Decide first:**
  - "Drop-in" without a contract conflicts with D-013 (no day passes); proposed as an OQ. Interim: drop-ins need a class contract.
  - How far ahead sessions are generated (proposed: 8 weeks, a parameter).
- **Depends on:** M5.3.

### M5.6 PT revenue allocation and booking report

- **Builds:**
  - **PT revenue allocation report:** one row per PT and contract with the columns of doc 10, a totals row per PT, and the adjustments column. The Excel keeps GymMaster's column order.
  - **Booking report.**
  - **A first overview dashboard.**
- **Source:** brief §6.5, §9; FR-PT-007; D-032; OQ-022 interim; AC-18.
- **Tests:** a fixed dataset gives the report figures; masking.
- **Decide first:** the owner sends a GymMaster "employee_pt_training" export with the data behind it, to match AC-18.
- **Depends on:** M5.5.

### M5.7 PT payouts and adjustments

- **Builds:**
  - **Payout expense vouchers** from a period of the allocation report. Each stores its period and the sessions it counted, so a session is never paid twice.
  - **Deleting a session of a paid period** creates an adjustment line in the next period.
- **Source:** brief §6.3, §8.1; FR-CASH-003; D-027, D-032; AC-16, AC-18.
- **Tests:** INT-011; the example from the brief: 27 sessions paid for October, then deleting a session of 20/10 on 15/11 adds a line to November.
- **Depends on:** M5.6.

**M5 close:** AC-02, AC-09, AC-11, AC-15, AC-16, AC-18, and AC-23 on staging.

## M6 — Automatic email infrastructure

The owner's answer of 12/10/2026 (D-059) makes this milestone the sending infrastructure; the templates are a small part. M6.1 is built first, at the start of M4 (P-6); M6.2 and M6.3 attach each event as the feature that causes it is built; M6.4 is the staff side.

### M6.1 Provider and sending (built first, as M4.0, 2026-10-12)

- **Builds:**
  - **A sender worker** (pg-boss) that sends the outbox through the provider (doc 26: Resend or Amazon SES), with retries.
  - **Status per email.** A failure creates a reception task.
  - **An "Emails sent" tab** on the customer.
  - **Domain authentication** (SPF, DKIM, DMARC), set up with the owner.
- **Source:** brief §8.3; FR-MAIL-003; D-036.
- **Tests:** the provider is mocked at its HTTP boundary; tests check that a failure leaves a task and the stored status.
- **Decide first:** the provider (TS in doc 26) and the sending domain; the owner adds the DNS records.
- **Depends on:** — (moved to the start of M4, P-6).

### M6.2 Templates and session emails

- **Builds:**
  - **Templates** per event in Vietnamese and English, with placeholders and a preview; admin edits them. The language follows the nationality group.
  - **Credited and refunded session emails**, exactly one per change, including the reason for a refund.
- **Source:** brief §8.3; FR-MAIL-001, FR-MAIL-002; AC-17.
- **Tests:** E2E-109's email part; integration for one email per change in the right language.
- **Depends on:** M6.1.

### M6.3 Optional events

- **Builds:** the events of D-059, each with its template and an admin on/off switch: a confirmed session (Đã tập, Khách không đến, Burn Show) with sessions taken and left, a refunded session, contract activated, receipt, renewal, upgrade, hold, transfer, cancellation, deactivation and reactivation with the new end date, and a contract expiring or running out of sessions (D-012 thresholds). Each event is attached when its feature is built (M4, M5, M8); this slice is closed when the last one is.
- **Source:** brief §8.3; D-012.
- **Depends on:** M6.2.

### M6.4 Staff notifications (email and phone)

- **Builds:**
  - **Email to staff** for the important events: a task near its reminder points, an overdue task, an approval waiting, an escalation from a workout session, a lead newly assigned or moved (D-053).
  - **Push on the phone** when the employee is signed in on a phone; a written proposal of the way (the web app on the home screen) and its limits on iPhone and Android comes first.
  - **Preferences:** each employee picks the types by email and by phone; admin marks the mandatory ones.
- **Source:** D-053, D-056; OQ-026 answered.
- **Tests:** the provider and the push service are mocked at their boundary; the preferences and the mandatory types; a muted type still arrives when mandatory.
- **Depends on:** M6.1 and M2.7.

**M6 close:** AC-17 on staging with the real domain.

## M7 — Workout plans and logs

### M7.1 Workout catalogs

- **Builds:**
  - **Catalogs:** equipment; body areas as a tree; exercises with area, equipment, Strength or Cardio, video link, and validity; stages.
  - **Option lists:** Flags, Actions, session summary, and impact, with the brief's values.
- **Source:** brief §7.1, §7.3 (lists); FR-WKO-001.
- **Depends on:** M5.3.

### M7.2 Templates and customer plans

- **Builds:**
  - **Plan templates:** stages × exercises.
  - **Customer plans** from a template or from scratch, by week and session. Set targets: Strength has weight, reps, rest, RIR, tempo, technique, notes, video; Cardio has time, speed, heart rate.
  - **PT and Master reviews.**
  - **Approval by the Master** (matrix row "Tạo và sửa giáo án, template").
- **Source:** brief §2 (matrix), §7.1–§7.2; FR-WKO-001, FR-WKO-002; D-033.
- **Tests:** choosing a Cardio exercise shows the cardio fields; a plan waits for the Master's approval.
- **Depends on:** M7.1.

### M7.3 Session log on a phone

- **Builds:** the log opens from a PT session and has three parts. Plan and actual sit on one row per set; actuals default to the plan, Flag to Normal, and Action to None.
- **Source:** brief §7.3; FR-WKO-003; AC-20, AC-23.
- **Tests:** E2E-111 (the log part) at phone width.
- **Depends on:** M7.2.

### M7.4 Escalation

- **Builds:** "Dừng + Escalation" notifies the manager and the Master at once, with a link to the session. It creates a task that stays in the waiting list until it is marked seen with a direction.
- **Source:** brief §7.4; FR-WKO-004; AC-21.
- **Tests:** E2E-111 (the escalation part).
- **Depends on:** M7.3.

### M7.5 Progress tab and weekly workout dashboard

- **Builds:**
  - **Customer tabs** Workout plans and Session logs and progress: sessions done against planned, phase and stage, trends per exercise, stress, energy, sRPE, and the Flag and Action history.
  - **Weekly dashboard:** Flag and Action percentages, customers with a non-Normal flag, a comparison with the previous week, open escalations, and drill-down.
- **Source:** brief §4.2, §7.5, §9; FR-WKO-005; AC-20, AC-21.
- **Tests:** a fixed dataset gives the dashboard's percentages.
- **Depends on:** M7.4.

**M7 close:** AC-20, AC-21, and AC-23 on staging.

## M8 — Contract change vouchers

All vouchers follow OQ-023's interim rule: Fitness Manager approval, with fees typed in with a reason. Their effects are part of the derived figures (T-050), never typed figures.

| Slice | Builds | Decide first |
|---|---|---|
| M8.1 Voucher framework, renewal, hold | One voucher model (kind, original contract, own fields, approval); the Package history tab; renewal adds months, days, or sessions with an amount paid by receipts; a hold (Bảo lưu) sets the status and moves the end date | Does a hold count against the 10-day freeze reminder (proposed: no, holds are the customer's request)? |
| M8.2 Upgrade and conversion | The remaining value moves to a new service or contract type | How the remaining value converts (sessions left × allocation per session?) is an OQ for the owner: it changes money |
| M8.3 Transfer and branch transfer | Remaining days and sessions go to another customer; the branch of use changes with a value and a fee; future bookings are handled | Do future bookings move or cancel (proposed: cancel, with a list)? |
| M8.4 Cancellation | Paid, value used, fee, refund (creates the refund expense voucher); the debt becomes zero; booked sessions are cancelled (OQ-030 interim); this replaces the cancellation of the first brief (D-010) | OQ-013 interim |

Source: brief §5.6; FR-CHG-001, FR-CHG-002; D-024. Depends on M4 and M5.

## M9 — Remaining reports and GymMaster import

| Slice | Builds | Source |
|---|---|---|
| M9.1 Overview dashboard and remaining reports | The final overview dashboard, the tasks report (A-045), and a check of every export against AC-01 | brief §9; doc 10 |
| M9.2 GymMaster import | A staging-first command: customers, active contracts, sessions used, receipts, staff, booking history; legacy codes kept; dry run; a cleanup list (session count different from the package name, price different from the tier) for the owner to confirm | brief §10, §11; D-039; FR-IMP-001 |
| M9.3 Reconciliation and cut-over | Totals of customers, contract value, paid, and sessions left against GymMaster; a parallel-run checklist; production import only after OQ-014 | AC-22 |

## M10 — Lead channel APIs (after the survey, TS-007)

| Slice | Builds |
|---|---|
| M10.0 Survey | Feasibility, cost, and app review for each channel, reported to the owner before building |
| M10.1 Intake gateway | Webhooks with signature checks, idempotency, stored messages, and mapping to the lead intake with its channel; the conversation is kept on the lead (M11 needs it) |
| M10.2 onward | One channel per slice in the survey's order: WhatsApp Business, Messenger and Instagram, Gmail forwarding and website form, Zalo OA (receive only), TikTok and Threads when available |

## M11 — AI-assisted audit (after OQ-025, TS-008)

| Slice | Builds |
|---|---|
| M11.1 De-identification and provider | Names, phones, and IDs removed before anything leaves the system; switched off until the owner consents |
| M11.2 Suggestions | Scores and common mistakes against the script library on the lead's Audit tab; the manager decides; evaluation with managers on past leads; cost per lead tracked |

## Order and parallel work

Slices run in the order above. M7 can start after M5.3 (it needs sessions), in parallel with the rest of M5, if a second developer joins. M10.0 (the survey) and the owner's answers to the open questions of the next milestone (doc 16) should happen during the milestone before.

## Checklist: the owner's answers of 12/10/2026

Each item of the owner's list of work for the developer, with where it is built. ☐ is open; the docs part (this checklist and D-046 to D-072) is done.

- ☑ M6 is "automatic email infrastructure", built at the start of M4 → M4.0 / M6.1 (P-6, D-059). Docs ☑, built ☑ 2026-10-12 (A-106); the domain waits for the owner (OQ-036).
- ☐ PT booking is not limited by shifts; a shift is an on-duty shift for display and reports → M5.2 (D-058). Docs ☑.
- ☑ A consultant's data scope is role configuration, not hard-coded → M2.7 checks it (D-061; built, A-095).
- ☑ The lead form needs no phone → M2.7 (D-060).
- ☑ Nationality is a list of countries, with the group and the email language derived → M2.7 (D-057).
- ☑ Several reminder points per task, 24 h, 3 h, 1 h → M2.7 (D-056).
- ☑ Lead turns by weight per person, receiving on/off → M2.7 (D-050).
- ☑ Reclaim after 1 hour inside 08:30–20:30, recorded and reported → M2.7 (D-052).
- ☑ Checklist lock, "Không thực hiện", per-step completion rates → M2.7 (D-054, D-055).
- ☑ "Quản lý trực tiếp"; departments, titles, and reporting lines; slow approvals to the direct manager → M2.7 (D-046, D-048).
- ☐ Staff notifications by email and phone, with a push proposal → M6.4 (D-053).
- ☑ Admin keeps the Master role first (D-049): nothing to build; admin already holds it.
- ☐ The next progress report follows these points → written by the developer at the end of M2.7.

From the updated brief of 12/10/2026 (§6.6 and the new acceptance criteria):

- ☐ Scan API, pairing rules, machine data, the hanging-session flow, and the manual-confirmation report → M5.3b (D-069 to D-072; AC-29, AC-30).
- ☐ Answer the NextFace ID survey (machine model; options A, B, C; whether fingerprints survive a change of software) before M5 → TS-009.
- ☐ The owner confirms the title → role table and the Marketing reporting lines → OQ-034; OQ-035 answered: the machines are integrated in the future; admin confirmation stays in phase 1.

The owner will send: the employees, PTs, titles, and branches for the trial; the coded "Chi tiết nhu cầu" list; the confirmed lists of channels, sources, needs, Pain Status, and Assessment type.
