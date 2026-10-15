# Documentation Changelog

## 2026-10-15 — M5.8: ZKTeco bridge

- **Bridge** (A-309, doc 33): `apps/zk-bridge` takes the TX628's push on the LAN and sends the punches to the scan API with the machine key, queued on disk and retried; proven end to end (E2E-185).
- **Open**: OQ-062 (ZKTeco's push document, the machine's administrator, where the bridge runs). Docs 13, 16, 18, 24, 28, 33, README.

## 2026-10-15 — ZKTeco answers

- **Machine** (A-306): one TX628 on the gym LAN with ADMS push available; GymMaster's NextFace reads it from the reception PC (on 7:00–20:30).
- **Photos** (A-308): firmware 8.0.4.3 with Push Service 2.0.33S, static IP with no gateway (LAN only), SDK port 4370, HTTPS push available, 196 users, no administrator set on the machine.
- **Proposed way in** (A-307): the machine pushes to a small bridge on the LAN, which calls the scan API over HTTPS; nothing built until OQ-062's remaining answers and ZKTeco's push document.

## 2026-10-15 — M10 closed; M9.2b: GymMaster's real exports

- **M10 close**: the full suite (E2E and OWASP, 1327 tests) green after M10.6.
- **Import** (A-301 to A-305): GymMaster's exports read as they come (several files, known by their headers), with their column names and value shapes; bonus sessions, contract type, PT and Sale shares; members from the contracts; cleanup reasons for GymMaster's own disagreements, unapproved contracts and unknown staff.
- **PT report**: GymMaster's *Tổng show* column.
- **Open**: OQ-078 (interim answers recorded). Docs 13, 16, 18, 28, 29.

## 2026-10-15 — Customer input: framework and GymMaster exports

- **Source**: the framework document transcribed in `docs/source/FRAMEWORK_2026-10-15_vi.md`; the exports are not stored (personal data).
- **Review** (doc 32): the framework mapped to what is built; PT pay of D-032 confirmed by GymMaster's report; the import needs the real headers and file layout (M9.2b).
- **Open**: OQ-078 (real exports), OQ-079 (new areas: campaign costs, Assessment results, retention, targets, BI).

## 2026-11-11 — M10.6: Zalo OA (receive only)

- **Channel** (A-294 to A-300): Zalo OA events signed with the OA Secret Key; the user id ties a person's messages; shared information brings the phone; nothing is sent.
- **Survey** (doc 30): the Zalo webhook, which could not be read before, is now confirmed on developers.zalo.me.
- **Fix**: messages of the same second keep the order they arrived in.
- **Open**: OQ-077. Docs 04, 07, 13, 16, 18, 24, 28, 30, 31 (§10).

## 2026-11-10 — M10.5: Gmail forwarding

- **Channel** (A-287 to A-293): an inbound-mail service posts each forwarded email with the source key as the Basic password; Gmail's confirmation for Admin; automatic mail skipped; the sender found by address, then by a written phone.
- **Open**: OQ-076. Docs 04, 07, 13, 16, 18, 24, 28, 31 (§9).

## 2026-11-09 — M10.4: Lead Ads

- **Forms** (A-281 to A-284): Lead Ads form leads on the Page's webhook; answers read from Meta with the sealed Page token; a lead or an inquiry with the answers.
- **Tests** (A-285): a stand-in for Meta's Graph API in the E2E run.
- **Open**: OQ-075. Docs 04, 07, 13, 15, 16, 18, 24, 28, 31 (§8).

## 2026-11-08 — M10.3: Messenger and Instagram

- **Channels** (A-275 to A-278): Messenger and Instagram sources at a shared Meta address; the sender id ties a person's messages; a new sender is a lead named after the channel.
- **Merge** (A-279): merging two records moves the received messages to the survivor (also fixes M10.1).
- **Open**: OQ-074. Docs 04, 07, 13, 16, 18, 24, 28, 31 (§7).

## 2026-11-07 — M10.2: WhatsApp

- **Channel** (A-268 to A-274): WhatsApp sources with the App Secret sealed; Meta's handshake and signed deliveries (HMAC over the exact bytes); the phone in the gym's form; one message once; one conversation within 24 hours.
- **Open**: OQ-073. Docs 04, 07, 13, 16, 18, 24, 28, 31 (§6).

## 2026-11-06 — M10.1: lead intake gateway

- **Gateway** (A-261 to A-265): sources with their own keys, the website form as the first channel, idempotent, rate limited; an existing phone becomes an inquiry.
- **Conversation** (A-266): messages stored on the person and shown on the lead page. Doc 31 for the website's developer.
- **Open**: OQ-072. Docs 04, 07, 09, 13, 16, 18, 28, 31.

## 2026-11-05 — M10.0: lead channel survey

- **Survey** (A-260, doc 30, Vietnamese docx for the owner): feasibility, cost and review of each channel, a proposed order, and what the developer needs from the owner.
- **Open**: OQ-071. Docs 16, 18, 28, 30.

## 2026-11-05 — M9.3: reconciliation and cut-over (M9 close)

- **Reconciliation** (A-256, A-257): customers, contracts, value, paid and sessions left compared three ways, with a failing exit.
- **Production guard** (A-258) and the **cut-over and parallel-run checklist** (A-259, doc 29 §6).
- **Open**: OQ-070. Docs 13, 16, 18, 28, 29.

## 2026-11-04 — M9.2: GymMaster import

- **Import command** (A-249 to A-255, doc 29): customers, staff and contracts from a workbook, dry run by default, legacy codes kept, opening balances (D-011), contracts renamed by real session count, cleanup list for the owner, report and run record.
- **Open**: OQ-069 (the real export formats). Docs 04, 13, 16, 18, 28, 29.

## 2026-11-03 — M9.1: tasks report, revenue by year, export check

- **Tasks report** (A-245, A-246): given, done on time, done late, overdue, by person and department, with its export.
- **Overview** (A-247): revenue by year. **AC-01 on exports** (A-248): a test over all 19 exports.
- **Open**: OQ-068. Docs 07, 09, 13, 16, 18, 28; E2E-178.

## 2026-11-02 — M8.4: cancellation (M8 close)

- **Cancellation** (A-240 to A-244): reason, value used, fee and refund; the contract ends with no sessions left and nothing owed; booked sessions are cancelled; the refund is an expense voucher linked to the contract.
- **Open**: OQ-067. Docs 04, 07, 13, 16, 18, 28; E2E-177.

## 2026-11-01 — Pagination: go to a typed page

- Every paginated list gets a box to type the page to go to when it has more than five pages (doc 23 `TablePagination`); the search and filters are kept.

## 2026-11-01 — M8.3: transfer and branch transfer

- **Transfer** (A-232 to A-234, A-237, A-238): all the sessions left and a value go to another customer as a new contract of type TRANSFER; no debt allowed; booked sessions are cancelled; both customers are emailed.
- **Branch transfer** (A-235, A-236, A-239): the one change the lock lets through, with an approved voucher; the fee is added to what is owed.
- **Open**: OQ-066. Docs 04, 07, 13, 16, 18, 28; E2E-176.

## 2026-10-31 — M8.2: upgrade and conversion

- **Exchange** (A-227 to A-231): the sessions left are exchanged for a new package on the same contract; the price less the credit is added to what is owed; counted at approval; always emailed.
- **Open**: OQ-065 (how the credit is worked out, the price lookup, the difference between the two kinds). Docs 04, 07, 13, 16, 18, 28; E2E-175.

## 2026-10-30 — M8.1: change vouchers, renewal and hold

- **Framework** (A-219, A-223 to A-225): one voucher table for every kind, approval per kind, effects set at approval and summed into the contract by a trigger; every figure of sessions and value now includes them.
- **Renewal** (A-220) and **hold** (A-221, A-222): sessions, days and an amount added; a hold moves the end date, cancels the sessions inside it and stops new bookings on its days.
- **Open**: OQ-063. Docs 04, 07, 09, 13, 16, 18, 28; E2E-174.

## 2026-10-30 — Fingerprint machines are ZKTeco

- **A-218**: the customer uses ZKTeco; the scan API stays the only entrance and a small bridge (a ZKBio Time poller or an ADMS receiver) is to be built once the software is known. TS-009 updated.
- The machine seen in a photo is a **TX628** on Ethernet: a third bridge kind, a small program on the gym's LAN reading the machine directly, is added.
- **Open**: OQ-062 (model, software, network, ZKTeco's API and ADMS documents). Doc 18.

## 2026-10-29 — M7.5: workout progress and the weekly dashboard

- **Dashboard** (A-212 to A-215): Flag and Action shares of the week's sets, customers with a Flag beyond Normal, the week before, escalations waiting, and drill-down to the sets.
- **Progress** (A-216): sessions against the plan, stage, scales, exercises and the Flag and Action history in the customer's profile.
- **Open**: OQ-061. Docs 07, 09, 13, 16, 18, 28; E2E-173.

## 2026-10-28 — M7.4: escalation

- **Escalation** (A-206 to A-211): *Dừng + Escalation* on a set tells the manager and the Master at once (app, email, push), makes a high-priority task in Giao việc, and waits until one of them marks it seen with a direction; the coach is told.
- **Open**: OQ-060. Docs 04, 07, 09, 13, 16, 18, 28; E2E-172.

## 2026-10-27 — M7.3: the session log

- **Log** (A-199 to A-205): one log for each PT session, opened from the session; plan and actual on one row per set, the actual starting as the plan; before, during and after parts with 1 to 10 scales; Flag and Action from the admin lists.
- **Open**: OQ-059. Docs 04, 07, 09, 13, 16, 18, 28; E2E-171.

## 2026-10-26 — M7.2: templates and customer plans

- **Plans** (A-192 to A-198): templates and customer plans of stages, sessions, exercises and sets with Strength and Cardio targets; approved by the Master through the approval engine, locked once in use, changed by revisions, made from a template, with PT and Master reviews.
- **Open**: OQ-058. Docs 04, 07, 09, 13, 16, 18, 28; E2E-170.

## 2026-10-25 — M7.1: workout catalogs

- **Catalogs** (A-188 to A-190): equipment, a tree of body areas, Strength and Cardio exercises with a video link, and plan stages; kept by Admin and the Fitness Manager, read by the Master and the PT.
- **Option lists of the log** (A-191): Flag, Action, impact and summary with the brief's values.
- **Open**: OQ-057. Docs 04, 07, 09, 13, 16, 18, 28; E2E-116.

## 2026-10-24 — M6.3 and M6.4: optional customer emails and staff notifications

- **Optional customer emails** (A-181, A-182): activated, renewal, receipt, hold, active again, cancelled, ending soon, running out; each with a template and an on/off switch.
- **Staff notifications** (A-183 to A-187): the important ones also by email and by push to the phone; each employee's choices, Admin's mandatory marks; the home-screen app and Web Push. New doc 29 (proposal and limits on iPhone and Android).
- **Open**: OQ-056. Docs 04, 07, 09, 13, 15, 16, 18, 24, 28, 29; E2E-114, E2E-115.

## 2026-10-22 — M6.2: email templates and the session emails

- **Templates** (A-177): the wording of each customer email in Vietnamese and English, edited by Admin with placeholders and a preview; mandatory content is enforced.
- **Language** (A-178, answers OQ-051): follows the nationality group.
- **Session emails** (A-179): credited (Đã tập), counted no-show, Burn Show, refund with the reason, and class attendance, exactly one per change.
- **Open**: OQ-055. Docs 04, 07, 09, 13, 16, 18, 28; E2E-113.

## 2026-10-21 — M5.7: PT payouts and adjustments

- **Payouts** (A-173, A-174, A-176): an expense voucher per PT and period, the amount worked out from the allocation report, the sessions it paid recorded so none is paid twice, also under concurrent requests; a voided voucher releases its sessions.
- **Adjustments** (A-175, D-027): a paid session deleted from the history is taken back, exactly, in the PT's next payout.
- **Open**: OQ-054. Docs 04, 07, 09, 10, 13, 16, 18, 28; E2E-112, INT-011.

## 2026-10-20 — M5.6: PT revenue allocation, booking report, overview

- **PT revenue allocation** (A-166 to A-170): a row per PT and contract, totals per PT, in and outside the shift, class sessions taught, Excel in GymMaster's column order. Service commission now starts at 100 (A-167); new parameter `ptTimesheetRate`.
- **Booking report** (A-171) and **overview dashboard** (A-172).
- **Open**: OQ-053 (the owner's `employee_pt_training` export for AC-18). Docs 04, 07, 09, 10, 13, 16, 18, 28; E2E-111.

## 2026-10-19 — M5.5: class schedule and attendance

- **Classes** (A-160, A-161): weekly slots with a coach and a capacity; sessions made eight weeks ahead (parameter `classGenerateWeeks`).
- **Enrollment and attendance** (A-162, A-163): on a group-class contract, refused when full, expired or out of sessions; present uses one session, absent none; a mark is final.
- **Coach credit** (A-164) and **the week board** (A-165). Sessions used of a contract now include class attendance.
- **Open**: OQ-052. Docs 04, 07, 09, 13, 16, 18, 28; E2E-110.

## 2026-10-18 — M5.4: delete from the check-in history, Burn Show

- **Delete a trained session** (A-157): Admin, with a reason; one session refunded, the PT credit removed, to the trash, audited. The payroll adjustment waits for M5.7.
- **Burn Show** (A-158): Admin adds a trained session by hand under the rules of a booking and of Đã tập, marked "added by hand".
- **Customer emails** (A-159): both changes queue one email in the outbox; the other session emails come with M6.2.
- **Open**: OQ-051. Docs 04, 07, 09, 13, 16, 18, 28; E2E-109.

## 2026-10-17 — M5.3b: fingerprint-ready check-in

- **Machines and scans** (A-153): a key per machine, the scan API, raw scans, machine user codes; no fingerprint is stored. The Origin check has one documented exception for the machine route (doc 24).
- **Pairing** (A-154) by the rules of D-070, into the one event "session confirmed" (A-155).
- **Hanging sessions, the PT's answers, the escalation, and the report of confirmations by hand** (A-156).
- **Open**: OQ-050. Docs 04, 07, 09, 13, 16, 18, 24, 28; E2E-169.

## 2026-10-16 — M5.3: session dialog, delete, bulk Đã tập

- **Đã tập straight from Booked** (A-150): no separate check-in step; check-in stays an optional fact. How a session was confirmed is kept.
- **Xóa** (A-151): a Booked session booked by mistake goes to the trash with a reason and frees the time.
- **Bulk Đã tập for a day** (A-152): a result per session.
- Docs 04, 07, 09, 13, 16, 18, 28.

## 2026-10-16 — M5.2: PT grid and booking

- **Any time bookable** (A-149, D-058): shifts and days off only tint the grid; the old "outside working hours" refusal is gone.
- **Customer overlap** is refused, also under concurrent requests (BR-403).
- **Service hours and limits**: hours of the day, sessions per day and per week per customer.
- **Grid**: day and week views, filters by branch, PT, and customer, a session count per column, phone width.
- **Open**: OQ-049. Docs 05, 07, 13, 16, 18, 28; E2E-168.

## 2026-10-15 — M5.1: configurable session statuses

- **Statuses** (A-145): Booked, Đã tập, Hủy lịch and Khách không đến are rules Admin edits (uses a session, credits the PT, locked once set, color); each session keeps the rule applied when its status was set.
- **Check-in** (A-146) is a fact on a Booked session, not a status.
- **No-show** (A-147) now uses a session and keeps the trainer's time, as D-025 says.
- **Cancel cut-off** (A-148): a parameter, off at first.
- **Open**: OQ-048. Docs 04, 07, 13, 16, 18, 28; E2E-167.

## 2026-10-15 — M4.1b: private file storage

- **Files** (A-143): pictures (PNG, JPEG, WebP up to 5 MB, checked by their bytes) in private storage (folder in development, Cloudflare R2 in staging and production); shown only through links signed for the user that expire in five minutes, and only to people who may see what the picture belongs to.
- **Service picture** and **transfer proof of a receipt** (A-144, brief §8.1; OQ-044 built as optional).
- **Fixed**: a body over the size limit answered 500 instead of 400.
- **Open**: OQ-047 (R2 bucket and keys, retention, whether a transfer needs its proof). Docs 04, 07, 13, 16, 18, 28; E2E-166.

## 2026-10-15 — M4.7: cash book and reports

- **Cash book** (A-138, AC-19): opening, in, out and closing per branch and method and per day, chained so the last closing is the period's; only approved, undeleted receipts and vouchers count. Admin sets the opening balance of each branch and method (audited).
- **Reports** (A-139 to A-142): income and expense by category, the contract report by service and session band (new, renewed, revenue, debt, expiring, running out), the exception-price report by creator and approver, and the member debt export. Each has Excel and its own permission; a new parameter `runningOutSessions` (3) says when a contract is running out.
- **Fixed**: the debt list counted rejected and deleted contracts.
- **Open**: OQ-046 (the starting cash, who else sees the cash book, bank accounts, cancelled contracts). Docs 04, 07, 09, 10, 13, 16, 18, 28; E2E-165.

## 2026-10-14 — M4.6: deactivation and reactivation

- **Deactivate** (D-023, A-133): Admin locks a running contract for review, with a reason; nothing is booked, checked in, marked no-show, or completed on it, it does not expire, and its booked sessions are highlighted.
- **Reactivate** (A-134): the dialog shows the frozen days and the proposed end date; Admin adds all, some, or none, with a reason; the end date changes once per freeze, also under concurrent requests.
- **Expiry** (A-135): stays derived, so a frozen contract never shows as expired; no nightly job was needed.
- **Reminder** (A-136): a freeze older than 10 days (a parameter) tells the managers and makes a task for the manager department.
- **Open**: OQ-045 (who else may deactivate, receipts and emails during a freeze). Docs 04, 07, 09, 13, 16, 18, 28; E2E-107, INT-008, INT-012.

## 2026-10-14 — M4.5: receipts and expense vouchers

- **Numbers** (D-034, A-129): every receipt and voucher has a number from a sequence, never reused; receipts (with or without a contract) are PT…, expense vouchers PC…; the prefixes are parameters.
- **Receipt and voucher fields** (A-130): salesperson and note on a receipt, payee and method on a voucher, a refund linked to its contract; the contract has a derived payment status.
- **Date edit** (A-132): a receipt's date is edited with its own permission and always logged.
- **Customer standing** (A-131, D-040): training, expiring soon, expired, or no contract, derived from approved contracts, with the window a parameter.
- **Open**: OQ-044 (the transfer proof image waits for file storage). Docs 04, 07, 09, 13, 16, 18, 28; E2E-164.

## 2026-10-14 — M4.4b: contract list and detail

- **The list** (brief §5.3, A-126): every column, nine filters (branch, type, contract date, service, PT, promotion, payment, signature, approval), the totals of value, paid, and debt over the whole filter, and the same filters in the Excel export.
- **The detail** (A-127, A-128): Information, Check-in history, and Package history tabs; Print (its own permission) opens a sheet; Update note (its own permission) works on approved contracts and is audited.
- **Open**: OQ-043 (the "hết hạn" column and the print template). Docs 07, 08, 09, 13, 16, 18, 28; E2E-162, E2E-163.

## 2026-10-14 — M4.4a: contract approval, lock, unapprove, delete

- **Approval through the engine** (D-018, A-120, A-121): a new contract is a request in the approval inbox (matrix action `contract.create`: Fitness Manager and Admin); approving makes it active, rejecting needs a reason and moves it to Rejected. Nobody approves their own; the approver's discount limit is checked (A-112). The contract page has Approve and Reject.
- **The lock** (D-022, brief §5.4, A-122): an approved contract cannot be changed, by the service or by a database trigger, even by Admin.
- **Lead status** (A-123): the first approved contract turns the customer's status to "Đã ký hợp đồng".
- **Unapprove and delete** (A-124, A-125): Admin sends an approved contract back to pending when no receipts or sessions exist, and deletes to the trash with a reason (the deletion waits for a second approver); receipts and sessions are listed when they block it.
- **Open**: OQ-041 (rejected contract), OQ-042 (unapprove with receipts or sessions). Docs 04, 07, 09, 13, 16, 18, 28; E2E-105 rewritten, E2E-160, E2E-161.

## 2026-10-12 — M4.3: the contract model and creation

- **The price comes from the tier** (BR-301, AC-10): a contract takes a service and a session count; the unit price, total, end date, and name ("Hybrid Training 30 buổi") are worked out from the version of the prices in force on the contract date. A count no tier covers is refused (A-107).
- **Promotion, voucher, VAT, exception price** (A-110, A-111, A-113): the promotion first, then the voucher on what is left, then VAT; an agreed price is an exception with a reason and approval, and activation checks the approver's discount limit (A-112, `DISCOUNT_ABOVE_LIMIT`).
- **Bonus, shares, companions, signature, first payment** (A-114 to A-119): bonus sessions, months, and days kept apart; PT and Sale shares totalling 100; companions of a group package; the first payment saved with the contract as a pending receipt, or nothing saved.
- **Form and screens**: the contract form is a page with a live price panel; the contract page shows the prices and staff. Existing contracts stay, flagged as imported. Seed scripts price contracts from services.
- **Open**: OQ-039 (exception price with a promotion) and OQ-040 (PT and Sale shares). Docs 04, 07, 08, 13, 16, 18, 28; E2E-104 rewritten, E2E-159.

## 2026-10-12 — M4.2: promotions, vouchers, and discount limits

- **Promotions and vouchers** (A-110, FR-SVC-004, BR-303): a percent or an amount off the tier price, with dates and services; not exception prices. A contract takes one of each, the promotion first, then the voucher on what is left. Admin manages them; staff see only the promotions on offer and never a voucher code.
- **Quote** (`GET /services/:id/quote`, A-111): the tier price, the promotion, the voucher, then VAT on the discounted price; one that cannot be used is refused, never ignored. The "Try a price" card shows it.
- **Discount limit per role** (A-112, FR-PLT-002): the largest discount, as a percent of the tier price, a role may approve itself; above it the contract goes to a role with a higher limit. `canApproveDiscount` is ready for the contract approval (M4.4). Initial limits are a proposal (OQ-038).
- Docs 04, 07, 08, 09, 13, 16, 18, 28; E2E-155 to E2E-158.

## 2026-10-12 — M4.1a: services and price tiers

- **Services** (A-109, FR-SVC-001): name, kind, branches, allowed hours, commission rate, group limit, limits per week and per day, validity; never deleted, only made inactive. Admin edits; every role that creates contracts or sees payments reads (`service.view`, `service.manage`).
- **Price tiers in versions** (BR-301, D-021): a version is the whole set of tiers from a start day and is never edited, so contracts keep the price they were signed at; tiers never overlap (also an exclusion constraint) and may leave gaps.
- **Lookup** (`GET /services/:id/lookup`, AC-10): any session count gives the unit price, total, display name ("Hybrid Training 30 buổi"), and the end date; a count no tier covers is refused (A-107); the end date counts the start day (A-108).
- **Quick-pick packages** (FR-SVC-003) and the admin screens under Configuration, with a "Try a price" card.
- **Open**: OQ-037, to check the end-date rule with one real contract; M4.1b (file storage on R2 and the service image) is next. Docs 04, 07, 08, 09, 13, 16, 18, 28; E2E-152 to E2E-154.

## 2026-10-12 — M4.0: email infrastructure

- **Outbox and sender** (A-106, P-6, T-051): the table `email_messages`, `queueEmail` for the features to call in their own transaction (one email per cause), and a `mail` worker every minute that sends through Resend (or only logs with `EMAIL_PROVIDER=log`). A busy or broken provider is tried again after 1, 5, and 30 minutes; a refusal, or a fourth failure, leaves the email Failed.
- **Failures reach people**: a customer without an address, or an email that finally fails, creates one task for the department of the new parameter `receptionDepartmentId` (Admin, Parameters, Email).
- **Emails sent tab** on the customer (`GET /customers/:id/emails`, FR-MAIL-003): status, attempts, and why one failed; no message body; the address hides from roles that may not see emails.
- **Open**: the sending domain, its DNS records, and the sender name (OQ-036). Docs 07, 13, 15, 16, 18, 22, 28; E2E-151.

## 2026-10-12 — Grouped sidebar, charts, paging

- **Sidebar** (A-105): about 25 flat items become collapsible groups (Leads and consulting, Customers and contracts, Schedule and sessions, Reports; under Administration People and access, Configuration, Monitoring). Only the group of the current page is open; the user's choice is remembered per browser. The structure is `lib/navigation.ts` with a unit test; E2E-147 to E2E-150. Docs 08, 13, 18, 23.
- **Charts** use five distinct hues instead of greys (the funnel colors each stage), the legend shows the configured labels, every category label shows, and a grouped chart grows with its rows (doc 23).
- **Paging**: every list defaults to 10 rows per page; the "Not audited yet" queue pages on its own (`queuePage`, `queueSize`) instead of showing only its first 10.

## 2026-10-12 — M2 slice 7: the owner's answers of 12/10/2026 built

- **Lead intake** (D-060, A-095): only name and channel are required; the duplicate notice of another consultant's lead says who has it, with no way in and no phone. **Nationality** is a country of ISO 3166-1 (D-057, A-096) with the group and the email language derived; old "foreign" data keeps the country empty, flagged; the lead analysis splits by country.
- **Organization** (D-046, D-048, A-098, A-099): the departments and 25 job titles of the org chart, the direct manager of an employee, and the title → role pairing in 09_RBAC.md; a slow approval is told to the approver's direct manager, else Admin. **Coded catalog** (D-066, A-097): any option can have a number; "Chi tiết nhu cầu" is a coded list with the old text as its note.
- **Lead assignment** (D-050, D-052, A-100, A-101): a turn weight and a receiving switch per consultant on a new page (Lead receiving), only people within their working hours are dealt leads, and an untouched lead moves to the next consultant after 60 working minutes inside 08:30–20:30, recorded, notified, and counted per person on the consulting dashboard.
- **Checklist lock** (D-054, D-055, A-102, A-103): a tick cannot be removed except by Admin with a reason; an overdue step locks as "Không thực hiện" after a grace period (120 minutes); the dashboard shows each step's completion and how those who did it fare against those who did not. **Reminders** (D-056, A-104): 24, 3, and 1 hours before a task's deadline, shared or its own.
- New: permission `lead.untick`, endpoints `GET` and `PUT /lead-receivers`, `POST /leads/:id/steps/:stepId/reopen`, error `STEP_LOCKED`, parameters `reclaimMinutes`, `consultingWindowStart`, `consultingWindowEnd`, `stepGraceMinutes`, `taskReminderHours` (replacing `taskDueSoonHours`), five migrations.
- Tests: shared 211, web 343, API unit 154, integration 476, E2E and security 691 (the full suite, run at the close of M2).
- Docs: 04, 06, 07, 09, 13, 16, 18 (A-095 to A-104, T-066), 24, 25, 28.

## 2026-10-12 — The updated brief (12/10/2026) replaces the copy in `docs/source`

- **`docs/source/BRIEF_V2_vi.md`** now holds the brief of 12/10/2026 ("Bản hoàn chỉnh (1)"). Changes against the 10/10 copy: the organization table and reporting lines (§2); the Master role given to Admin first; slow approvals to the direct manager; the lead form with a name and a channel only; weighted turns, receiving on/off, and the automatic move after 1 hour inside 08:30–20:30 with a log; the country list; the checklist lock and its purpose; PT booking at all hours with on-duty shifts; the new **§6.6 fingerprint-ready check-in** (pairing rules, scan API, machine user codes, the NextFace ID survey); several reminder points and staff email and phone notifications (§8.2); §8.3 as the automatic email infrastructure; the employee and data-model fields; seven new acceptance criteria; seven new rows in the decisions table; and the open questions reduced to the remaining ones.
- **Doc 18:** D-069 to D-072 (fingerprint-ready check-in, pairing rules, hanging sessions, machine data), TS-009 (the NextFace ID survey), OQ-027 reworded, OQ-034 (title → role table and Marketing reporting lines), OQ-035 (the brief's decisions table still says "no fingerprint integration yet"). D-013, D-002, and D-026 are amended; D-046 and D-053 carry the brief's reporting lines and the PT's unfinished check-ins.
- **Doc 28:** new slice M5.3b, plan decision P-9, and three items on the owner's checklist. **Doc 14:** AC-24 to AC-30. **Docs 01, 16, 19, 25 and AGENTS.md:** the fingerprint scope line and the milestone tables.
- The reply of 12/10 had shown the Studio Manager reporting to "CEO, Trợ lý CEO" and some Marketing lines differently; the brief's table is built and OQ-034 asks the owner to confirm.

## 2026-10-12 — The owner's answers of 12/10/2026 recorded (docs only, no code)

- **Doc 18:** D-046 to D-068 record the owner's reply to the progress report and the org chart (Ver 2): organization, departments, titles, direct manager and the title → role mapping; task assignment; slow approvals to the direct manager; Master with Admin; weighted lead assignment with receiving on/off; re-care after 15 days; reclaim after 1 hour inside 08:30–20:30 with a move log and a report; staff email and phone notifications; the checklist lock and its purpose (measure the process); several reminder points; nationality as a country list; PT booking at all hours with on-duty shifts; M6 as the email infrastructure built first; the lead form without a phone; and the confirmations of the 7 provisional points, scale, cost, and the old version.
- **Closed:** OQ-017, OQ-018, OQ-019, OQ-020, OQ-024, OQ-026, OQ-028, OQ-029, OQ-031 (answered). **Amended or superseded:** D-030, A-027, A-042, A-043, A-046, A-047, A-049, A-052.
- **Doc 28:** new slice M2.7 (customer feedback follow-up), M4.0 (M6.1 moved to the start of M4), M6 renamed "Automatic email infrastructure", new M6.4 (staff notifications), M5.2 without the shift limit, plan decisions P-6 to P-8, and a checklist of the owner's list.
- **Docs 16 and 25:** the M6 name, the M2.7 row, the open questions per milestone, and the reworks.

## 2026-10-12 — M3 slice 4: consulting dashboard and lead analysis

- **Dashboard tư vấn** (brief §9): for the leads created in a period, per consultant and for the team: leads received, consulted, booked, shown, and contracted (a funnel chart and a table), booking rate, show rate, on-time compliance, the audit score, the median time to the first response, and the re-care results (how many entered and how many were booked again). Filters: period, branch, and person in charge.
- **Phân tích lead**: the same leads by contact channel, source, Organic or Paid, need group, nationality, and refusal reason, each with a chart and a table of leads, booked, shown, contracted, and the rates, plus the notes written with "Khác", most used first, so admin can turn them into options.
- **How it counts** (A-089 to A-091): a cohort of the people who came in as leads in the period. Consulted = the first step of the checklist is done; Booked = ever Booked; Show = shown; Contracted = has an approved contract. Booking rate = booked ÷ received; show rate = shown ÷ booked. The reports hold counts and rates, never a name or a phone.
- **Charts** (A-094): one shared chart over the shadcn Chart (new dependency recharts); each chart has its figures in a table beside it.
- **Permissions** (A-093): `report.consulting` (Admin, Fitness Manager, and Consulting, who see their own leads), `report.leadAnalysis` (Admin, Fitness Manager, Marketing), and an Excel export permission for each. Both reports export to Excel like the lists do.
- API: `GET /reports/consulting`, `/reports/lead-analysis` and their `/export`.
- Tests: unit (shared 176, web 331, API 151), integration 429, E2E and security 644.
- Docs: 07, 09, 13, 16, 18 (A-089 to A-094), 23, 24, 28.

## 2026-10-12 — M3 slice 3: the manager audit

- **Manager audit** (brief §4.1, FR-LEAD-011): on a lead's page a manager (`lead.audit`) grades the consulting Pass or Fail, with a comment. A Fail names the criteria not met, chosen from a new admin list "Tiêu chí audit chưa đạt" (only "Khác" at first; "Khác" needs the comment); a Pass names none. Every grade is kept and the latest counts (A-086, A-087).
- **Who sees it**: whoever can see the lead sees its latest grade, comment, and criteria, and the earlier grades, so the consultant learns the result; only managers get the button to grade.
- **Queue "Chưa audit"** (A-088): on the audit page, the oldest people nobody has graded yet, narrowed by consultant and period; a person leaves it once graded, whatever the result. The consultants' table has a new column with each one's count.
- The history records that a grade was made and its result, never the comment.
- API: `GET` and `POST /leads/:id/audits`, `GET /lead-audit/queue`; the consultants' table also answers `unaudited`.
- Data: `consulting_audits`, `consulting_audit_criteria`, the option list `auditFailReasons`.
- Tests: unit (shared 166, web 323, API 147), integration 415, E2E and security 595.
- Docs: 04, 06, 07, 13, 16, 18 (A-086 to A-088), 24, 28.

## 2026-10-12 — M3 slice 2: the automatic consulting audit

- **Audit tư vấn** (brief §4.1, FR-LEAD-011): a new menu item for managers (permission `lead.audit`: Admin, Fitness Manager). It shows each consultant's steps as on time, late, or skipped, their compliance (on-time steps ÷ due steps) and score, and the team's, and under it "Lead cần kiểm tra": leads still in the journey with a late or skipped step or a missing field, most urgent first. Filters: leads created in a period, and one consultant.
- **How steps count** (A-081): a step counts once it is due. On time: done by its deadline. Late: done after it, or still open past it. Skipped: never done, and the person was shown or contracted in the meantime. Waiting steps and steps not yet due count for nothing.
- **The score** (A-082): every due step is a check of weight 1, and so is each active criterion that applies to the lead, at its own weight; the score is the weight passed over the weight checked. A consultant's figures add up their leads' checks, not an average of lead scores.
- **Criteria** (A-083): need group, phone, and refusal reason (only for Refused leads), each with a switch and a weight of 1 to 10, edited under Administration → Audit criteria. A change applies to every score at once, and is in the action history. A user who cannot see phones is not shown the phone criterion.
- **The lead page** has an Audit card for managers: the score, the on-time rate, how each step went, and the criteria.
- API: `GET /lead-audit/consultants`, `/lead-audit/leads`, `/lead-audit/leads/:id`, `/lead-audit/criteria`, `PUT /lead-audit/criteria`.
- Data: `audit_criteria`; the figures are computed from `lead_steps`, never stored.
- Tests: unit (shared 166, web 321, API 144), integration 402, E2E and security 570.
- Docs: 04, 06, 07, 09, 13, 16, 18 (A-081 to A-085), 24, 28.

## 2026-10-12 — M3 slice 1: Excel export

- **Export Excel** (brief §1, §2): customers, leads, contracts, receipts, income and expenses, tasks, the action history, the trash, and the users each have an Export Excel button. The file holds every row the list shows for the same search, filters, branches, and data scope, not just the page; the screen's hidden fields (D-017) are not columns of the file. One writer owns it all: a list declares its columns once.
- **Permissions** (A-077): one per list, `customer.export`, `lead.export`, `contract.export`, `payment.export`, `cash.export`, `task.export`, `audit.export`, `trash.export`, `user.export`, in a new "Export to Excel" group; each is needed in addition to seeing the list. Admin has all nine; Fitness Manager the first six.
- **Row limit** (A-078): the new system parameter "Most rows in one export" (50,000 by default, 100 to 200,000) under Administration → System parameters. A longer list is refused with a message that names the limit and the count, before anything is sent; narrow the filters.
- **The file** (A-079): a bold header row in the user's language, dates as dates in the gym's time, money as numbers, and text never as a formula (a name like `=HYPERLINK(...)` stays text). Named after the list and the day, e.g. `customers-20261012.xlsx`.
- **Audit** (A-080): every export is recorded: who, which list, the filters, and the row count; the search text only as present, since it may be a phone.
- Fix: `PATCH /customers/:id` with an id that is not a UUID answered `500`; it is now `404`.
- API: `GET /<list>/export` for the nine lists; error `EXPORT_TOO_LARGE` (422).
- Tests: unit (shared 154, web 311, API 139), integration 385, E2E and security 526.
- Docs: 07, 09, 13, 16, 18 (A-077 to A-080), 23, 24, 28.

## 2026-10-12 — M2 slice 6: scripts, notes, and the customer profile

- **Script library** (brief §4.1, FR-LEAD-010): managers (new permission `script.manage`: Admin, Fitness Manager) manage "Kịch bản tư vấn" under Administration: a situation and its answer in Vietnamese and English, order, and an on/off switch; the 12 situations of the brief are there from the start with empty answers, to be entered from the owner's sheet. Scripts are never deleted. On a lead, a "Kịch bản" panel (full width on a phone) picks a situation and copies the answer in the customer's language: English for a foreign lead, Vietnamese otherwise, switchable (A-072, A-073).
- **Lead notes** (FR-LEAD-006): dated notes with the author at the top of the lead's history. They are never edited or deleted, and the history records that a note was added, not what it says (A-074).
- **Customer profile** (brief §4.2, FR-CUS-001): address, emergency contact (name and phone), customer group (new option list `customerGroups`), and staff in charge, in the add and edit forms and on the Information tab. The address and the emergency contact are hidden together by a new hideable field, nobody has it hidden by default (A-069 to A-071).
- **Customer list**: filters on the left for branch, staff in charge, registration days, birthday month, and "without email"; customers without an email are marked for reception (FR-CUS-003, FR-CUS-005, A-075).
- **Consulting history tab** on the customer page: the lead's timeline (notes, status changes, assignments, inquiries, merges) and its checklist, read-only. It replaces the "Inquiries and merges" card (A-076).
- **Lists**: every paginated list has the same footer: rows per page (10, 20, 50, 100), first, previous, numbered pages, next, and last, keeping the search and filters (`TablePagination` with `lib/paging.ts`). Toasts have a close button. `pnpm db:seed:bulk` loads volume data for trying the lists by hand (leads in every status, customers with contracts, payments, sessions, tasks, deletions, pending approvals).
- API: `/consulting-scripts` (list, create, `PATCH`, `PUT /order`), `POST /leads/:id/notes`, `GET /customers/staff`, filters on `GET /customers`, the profile fields on create and `PATCH`; the timeline and the checklist also open for the customer a lead became (`customer.view`).
- Data: `consulting_scripts`, `lead_notes`, profile columns on the customers table, the option list `customerGroups`.
- Tests: unit (shared 154, web 310, API 130), integration 368, E2E and security 426.
- Docs: 04, 07, 09, 13, 16, 18 (A-069 to A-076), 23, 24, 28.

## 2026-10-12 — M2 slice 5: re-care and merge

- **Danh sách tái chăm sóc** (FR-LEAD-007, BR-204): a new menu item lists the leads in No response, Refused, or No show by the day to contact them again (those without a date last). Filters: status, overdue; mine (default) or all. It works on a phone.
- **Re-care step results** (brief §4.1 step 10): "Đặt lịch" asks for the appointment and books the lead again, so the pre-visit steps start again; "Từ chối" asks for the reason and sets the next contact-again day, 15 days after today each time (A-062). A lead entering re-care notifies its consultant and the managers.
- **Duplicate phone** (BR-202, FR-LEAD-009): the quick form answers that the phone already has a record and offers "Gộp vào hồ sơ này": the new channel, source, need, and note are added to the existing lead or customer as an inquiry on its timeline, and no second record is created. A returning lead stays with its consultant while they still receive leads, and comes back to Consulting from re-care (A-063).
- **Merge two records** (D-019): managers (new permission `lead.merge`: Admin, Fitness Manager) merge a duplicate from the lead or customer page. The customer is kept, or the older of two leads; empty fields are filled, never overwritten; history, tasks, and steps move; the other record goes to the trash with the reason and its codes stay reserved. Merging two customers is refused until OQ-033 is answered (A-064 to A-067).
- Customer page: inquiries and merges are listed under the details (needs `customer.view` for customer records, A-068).
- API: `GET /leads/recare`, `POST /leads/intake`, `POST /persons/:id/inquiries`, `GET /persons/:id/intake-history`, `POST /persons/:id/merge`; errors `DUPLICATE_PHONE`, `MERGE_CUSTOMERS_UNSUPPORTED`, `PERSON_ALREADY_MERGED`; notifications `leadRecare`, `leadInquiry`, `personMerged`.
- Tests: unit (shared 142, web 286, API 124), integration 341, E2E and security 385.
- Docs: 04, 05, 06, 07, 09, 16, 18 (T-065, A-062 to A-068, OQ-033; A-051 amended), 28.

## 2026-10-11 — Slice plan

- New `docs/28_SLICE_PLAN.md`: every remaining slice from M2.5 to M11. Each slice lists what it builds, its sources, data, API, and screens, the tests to write, the decisions to settle before coding, and what it depends on. Plan-level proposals: the consulting-Excel import moves to M3 for AC-08; a shared Excel export in M3.1; file storage in M4.1; staging before the M2 trial; an email outbox from M5.4.
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
