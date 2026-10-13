# 05 — Business Rules

Rules are binding. Values written here are **initial configuration** (D-015) unless the rule is a fixed flow. Rules BR-001 to BR-018 come from the first brief; their status is listed at the end.

## Platform

- **BR-101** Every business record belongs to a branch; a user sees and acts only in the branches granted to them (D-014, D-017).
- **BR-102** Results, statuses, categories, and reasons are chosen from option lists. "Khác" cannot be saved without a note. Deactivated options remain on old records (D-016).
- **BR-103** Actions configured in the approval matrix take effect only after approval by someone other than the submitter. Overdue requests remind the approver and notify their superior (D-018).
- **BR-104** Business data is never hard-deleted. Deletion requires a reason, moves the record to the trash permanently, and removes it from lists, reports, and revenue (D-035).
- **BR-105** Codes are generated with configurable prefixes, are unique, and are never reused; imported legacy codes are kept (D-038).
- **BR-106** Every create, update, delete, approval, and change of roles, permissions, thresholds, or configuration is audited with before and after values (T-048).
- **BR-107** Accounts can sign in only within their allowed hours and days; sign-ins are recorded with device and IP (D-017).

## Leads and customers

- **BR-201** One person has one record; a lead becomes a customer at Show and keeps its ID (D-019).
- **BR-202** A new lead or contact with a phone number already in use triggers a duplicate warning and a merge proposal; no second record is created (D-019). Built (M2 slice 5): the quick form answers `DUPLICATE_PHONE`; "Gộp vào hồ sơ này" adds the new inquiry to the existing lead or customer; managers merge two existing records (A-063 to A-068).
- **BR-203** Leads are assigned round-robin to active consultants of the branch; managers may reassign (D-020, OQ-017).
- **BR-204** Refused requires a reason. Refused, No response, and No show leads enter the re-care queue with a contact-again date (initially 15 days) and are never closed (D-020, OQ-018). The next contact-again day is `recareDays` after today every time (A-062); the lead stays with its consultant, who and the managers are notified (M2 slice 5).
- **BR-205** Each consulting step creates a task with a deadline from the checklist; its result is a drop-down; it is marked on time, late, or skipped. Checklist changes apply only to new leads (D-020).
- **BR-206** Converting to a customer requires ID card/passport, birth date, nationality, and email (brief §4.1, D-036).
- **BR-207** Customer status is derived from contracts: training, expiring soon, expired, on hold, no contract (D-040).

## Services, prices, contracts

- **BR-301** A contract's unit price, total, and end date are computed from the service's price tier for the number of sessions; nobody types a unit price. The display name is the service plus the real session count (D-021).
- **BR-302** A price different from the tier, or a manual discount outside promotions and vouchers, is an exception price: reason required, approval required, both prices stored (D-021).
- **BR-303** Promotions and vouchers apply to the tier price and are not exception prices (D-021).
- **BR-304** A contract is created *Pending approval* and can be edited only while pending. Only an approved contract can be activated and booked (D-022). A contract the approver rejects is *Rejected* and has no effect; an approved one can be sent back to pending only with no receipts or sessions (A-121, A-124).
- **BR-305** An approved contract is never edited, even by admin. Changes go through change vouchers (D-022, D-024).
- **BR-306** A contract cannot be deleted while it has receipts (the system lists them), recorded sessions, or change vouchers. Deletion order: receipts first, then the contract (D-022).
- **BR-307** Deactivation and reactivation require reasons. While frozen: no booking, check-in, or Burn Show, and no expiry. Reactivation proposes extending by the frozen days; admin accepts, edits, or declines with a reason; each freeze extends at most once. A freeze longer than 10 days creates a reminder task (D-023).
- **BR-308** PT and Sale shares on a contract each total 100% (D-022).
- **BR-309** Opening balances of imported contracts are set once and never edited (D-011).

## Sessions and classes

- **BR-401** Booking never consumes a session (D-004, D-025).
- **BR-402** A booking requires an approved, active contract with sessions left, not expired and not frozen, inside a bookable cell of the PT's working schedule (D-030; OQ-001 interim: the session's day is within the contract dates, A-017).
- **BR-403** A PT cannot have two sessions at once, and a customer cannot have two sessions at once, while the statuses hold the slot (A-024). Enforced by the database (T-014).
- **BR-404** Each session status has one rule: consumes a session or not, credits the PT or not, and a color. Initial rules: Đã tập (yes, yes), Khách không đến (yes, yes), Hủy lịch (no, no), deleted (no, no). The rule applied is stored on the session (D-025, T-050).
- **BR-405** "Đã tập" requires its own permission (admin by default) and is final (D-026).
- **BR-406** A recorded session is corrected only by deleting it from the check-in history: reason required; one session refunded; PT credit removed; reports recomputed; moved to the trash; the customer emailed (D-026).
- **BR-407** Deleting a session in a period already paid to the PT keeps the payout and adds a negative adjustment to the PT's next period (D-027).
- **BR-408** Burn Show adds a session by hand with a mandatory reason; it consumes and credits like Đã tập and is marked "added by hand" (D-028).
- **BR-409** Repeating a status change never consumes twice, also under concurrent requests (T-013, T-050).
- **BR-410** Cancellation (Hủy lịch) has no time limit while the cut-off parameter is off (D-029).
- **BR-411** Class enrollment is refused when the class is full or the group-class contract is out of sessions or expired. *Present* consumes one session of that contract; each class taught counts as a teaching session for the coach (D-031).

## Workouts

- **BR-501** Plans and every session log of a customer are visible in the customer's profile (D-033).
- **BR-502** A session log has one row per set, holding the plan (read-only) and the actual; Cardio rows show time, speed, and heart rate instead of weights (D-033).
- **BR-503** Action "Stop + Escalation" notifies the manager and Master immediately and creates a task that stays open until one of them marks it reviewed with a handling note (D-033).
- **BR-504** Creating and editing plans and templates needs Master approval in the initial matrix (D-018).

## Money

- **BR-601** Collecting money on a contract always creates a receipt (D-034).
- **BR-602** Paid amount, debt, and payment status are computed only from valid receipts (approved, not deleted) plus the opening paid amount (D-034, D-011).
- **BR-603** Receipt and expense amounts are greater than zero.
- **BR-604** A receipt may not take the paid amount above the contract value (OQ-003 interim).
- **BR-605** Editing a receipt's date is a separate permission and is always logged (D-034).
- **BR-606** A refund on cancellation is an expense voucher linked to the contract (D-024, D-034).
- **BR-607** PT revenue = credited sessions × (allocation value ÷ (sessions bought + bonus)) × commission rate × timesheet rate; several PTs on one contract split by sessions taught (D-032).
- **BR-608** A payout voucher stores the period and the sessions paid; a session is never paid twice (D-032).
- **BR-609** Cash book closing balance = opening balance + receipts − expense vouchers, per method and branch (D-034).

## Notifications and tasks

- **BR-701** Every credited or refunded session sends exactly one email to the customer, in the language of their nationality group, and is stored with its status; a failure creates a task for reception (D-036, A-027).
- **BR-702** The assignee must acknowledge a task; overdue tasks are highlighted and reported to the assigner (D-037).

## Status of the first brief's rules

| Rule | Status |
|---|---|
| BR-001 Unique immutable customer ID | Active as BR-105, BR-201 |
| BR-002 Multiple contracts per customer | Active |
| BR-003 Booking needs an active contract with sessions left | Active as BR-402 |
| BR-004 Booking does not consume | Active as BR-401 |
| BR-005 Check-in does not consume | Superseded by BR-404/BR-405 |
| BR-006 Completion consumes exactly one | Superseded by BR-404 |
| BR-007 Completion is idempotent | Active as BR-409 |
| BR-008 Cancel and no-show do not consume | Superseded by BR-404 (no-show consumes) |
| BR-009 Remaining sessions never below zero | Active (a consuming status is refused when no session is left) |
| BR-010 No trainer overlap | Active as BR-403 (plus customer overlap) |
| BR-011 End after start | Active |
| BR-012 Booking within contract dates | Active (OQ-001) |
| BR-013 Debt is derived | Active as BR-602 |
| BR-014 Payment amount > 0; voided payments do not count | Active as BR-603, BR-104 |
| BR-015 Auditability | Active as BR-106 |
| BR-016 Authorization by role | Superseded by BR-101 and `09_RBAC.md` |
| BR-017 Contract cancellation cancels booked sessions | Active as interim of OQ-030 |
| BR-018 Opening balances | Active as BR-309 |
