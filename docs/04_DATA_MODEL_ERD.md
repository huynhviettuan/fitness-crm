# 04 — Data Model & ERD

Detailed schema for phase 1, based on brief §10. It is the target for `apps/api/prisma/schema.prisma`; the tables built in Phases 0–4 migrate into it (`25_BRIEF_V2_GAP_ANALYSIS.md`).

**Conventions** (apply to every business table unless noted):

| Convention | Rule |
|---|---|
| Keys | `id uuid` primary key. |
| Branch | `branch_id` (D-014). |
| Who and when | `created_by`, `created_at`, `updated_by`, `updated_at`; datetimes are `timestamptz` in UTC; calendar days are `date` in the gym timezone. |
| Soft delete | `deleted_at`, `deleted_by`, `delete_reason_option_id`, `delete_reason_note`; a row in `trash_entries` keeps a snapshot (D-035, T-047). |
| Money | `numeric(14,0)` VND (A-002). |
| Option references | Drop-down values reference `options.id` plus an optional `*_note`, which is required when the option is "Khác" (D-016). |
| Approval | Records that can need approval carry `approval_status` (`PENDING`, `APPROVED`, `REJECTED`, `NOT_REQUIRED`) and `approval_request_id` (D-018). |

## Core axis

```mermaid
erDiagram
    BRANCH ||--o{ PERSON : has
    PERSON ||--o{ CONTRACT : signs
    SERVICE ||--o{ PRICE_TIER : priced_by
    SERVICE ||--o{ CONTRACT : sold_as
    CONTRACT ||--o{ CONTRACT_STAFF : "PT and Sale splits"
    CONTRACT ||--o{ FREEZE : frozen_by
    CONTRACT ||--o{ CHANGE_VOUCHER : changed_by
    CONTRACT ||--o{ SESSION : consumes
    CONTRACT ||--o{ RECEIPT : paid_by
    CONTRACT ||--o{ EXPENSE_VOUCHER : refunded_by
    EMPLOYEE ||--o{ SESSION : teaches
    EMPLOYEE ||--o{ PT_SCHEDULE : works
    SESSION ||--o| SESSION_LOG : logged_in
    PERSON ||--o{ CUSTOMER_PLAN : follows
    CUSTOMER_PLAN ||--o{ PLAN_LINE : contains
    SESSION_LOG ||--o{ SET_RESULT : records
    PERSON ||--o{ CONSULTING_STEP : worked_through
    PERSON ||--o{ APPOINTMENT : books
    CLASS ||--o{ CLASS_SESSION : occurs
    CLASS_SESSION ||--o{ ATTENDANCE : records
    ATTENDANCE }o--|| CONTRACT : consumes
    EMPLOYEE ||--|| USER_ACCOUNT : signs_in_as
    USER_ACCOUNT }o--|| ROLE : has
```

## Tables

### Platform (brief §2, §8.4, §8.5)

| Table | Key fields |
|---|---|
| `branches` | name, address, active |
| `employees` | employee_code (prefix parameter, initially NV; trainer codes kept), full_name, search_name, birth_date, gender, phone, email, department_option_id + department_note, team, title_option_id + title_note, branch_id, status (ACTIVE, INACTIVE), is_trainer, manager_id (the direct manager, another employee, D-046), user_id (unique). ID document (encrypted) arrives in M2 (A-041). Built in M1 slice 6 from `trainers` (T-058) |
| `users` (M2.7, A-100) | lead_weight (1 to 20, initially 1), receives_leads (the switch for leave or busy) |
| `employee_shifts` | employee_id, weekday (ISO 1–7), start_minute, end_minute (end exclusive, up to 1440); exclusion constraint: no overlap per employee and weekday |
| `employee_days_off` | employee_id, date (unique per employee), note |
| `user_accounts` | username, email, employee_id (unique), role_id, all_branches, active; Better Auth `auth_*` tables keep sessions and password hashes |
| `user_branches` | user_id, branch_id |
| `user_access_windows` | user_id, weekdays (ISO 1–7), start_time, end_time (`HH:mm`, half-open, gym timezone); no rows = any time |
| `login_history` | user_id (null for an unknown account), email, at, success, reason (A-033), ip, user_agent |
| `roles` | code (seeded roles only), name (unique), description, cloned_from |
| *(no table)* | The permission catalog (key, group, label) lives in `packages/shared` (T-054) |
| `role_permissions` | role_id, permission_key |
| `user_permission_overrides` | user_id, permission_key, granted (on/off) |
| `role_data_scopes` | role_id, resource (leads, members, contracts, schedule, vouchers, staff, history), scope (ALL, OWN); a missing row = OWN |
| `role_field_masks` | role_id, field (member phone, email, address, documents; receipt totals) |
| `approval_rules` | action_type (unique; keys are code, T-057), required, overdue_hours (1–720); approver roles in `approval_rule_roles` (action_type, role_id). Escalation by discount threshold arrives with M4 |
| `approval_requests` | action_type, entity_type, entity_id, branch_id, title, amount, payload (json), submitted_by, submitted_at, status (PENDING, APPROVED, REJECTED, CANCELLED), decided_by, decided_at, reject_reason_option_id, reject_reason_note; checks: decided_by ≠ submitted_by, decision complete; one PENDING per action and record |
| `options` | list_key (channels, sources, needs, refusal reasons, delete reasons, freeze reasons, exception reasons, step results, flags, actions, session summaries, income categories, expense types, payment methods, departments, …; the keys are code, T-055), label_vi (unique per list), label_en, sort_order, active, is_other; one "Khác" per list, always active (A-034). Records keep `<field>_option_id` and `<field>_note` |
| `options` (M2.7, A-097) | code (optional number, unique in its list, D-066); the lists `needDetails` and `stepReopenReasons`; the seeded departments and job titles (D-046) |
| `system_parameters` | key (unique), value (json) — timers, thresholds, calendar hours, code prefixes, cancel cut-off, freeze reminder days, re-care days; keys and defaults are code, a missing row means the default (T-055) |
| `session_status_rules` | status key, label, consumes, credits_pt, color token, active |
| *(sequences)* | One PostgreSQL sequence per code (`customer_code_seq`, …); the prefix is a system parameter — codes never reused (D-038, T-055) |
| `audit_events` | actor_user_id, entity_type, entity_id, action, before (json), after (json), at (T-048) |
| `trash_entries` | entity_type, entity_id, snapshot (json), deleted_by, deleted_at, reason_option_id, reason_note — no update or delete path |
| `notifications` | user_id, kind, params (json: the values the text needs), link, read_at, created_at; the web app writes the text in the user's language (T-060) |
| `files` | storage_key, mime, size, owner entity, uploaded_by |

### Leads, consulting, customers (brief §3, §4)

| Table | Key fields |
|---|---|
| `people` (built as `customers`, T-061; ID document, nationality, health note, and data consent since T-064) | lead_code, customer_code (set at Show), stage (LEAD, CUSTOMER), status (lead statuses, D-020), pic_employee_id, full_name, gender, birth_date, phone (unique per active person), email, nationality_group, nationality, id_document (encrypted), address, health_basic (encrypted), customer_group_option_id, channel_option_id, source_option_id, source_type (ORGANIC, PAID), source_detail, need_group_option_id, need_detail_option_id, need_note, pain_status_option_id, assessment_type_option_id, emergency_contact, consent_at, notes |
| `people` (M2.7, A-096, A-097) | country_code (ISO 3166-1; nationality_group derived from it), need_detail_option_id (the coded catalog; need_detail is its note) |
| `person_merges` | kept_person_id, merged_person_id, by, at |
| `lead_inquiries` (T-065) | person_id, branch_id, channel_option_id, channel_note, source_option_id, source_note, source_type, source_detail, need_group_option_id, need_group_note, need_detail, note, created_by, created_at; one row per later intake on an existing record (BR-202) |
| `lead_notes` (M2 slice 6, A-074) | person_id, body, created_by, created_at; append-only, never edited or deleted; stays with the record after Show |
| `consulting_audits` and `consulting_audit_criteria` (M3 slice 3, A-086, A-087) | person_id, result (PASS, FAIL), comment, auditor_id, created_at; the criteria not met are rows (audit_id, option_id) from the list `auditFailReasons`; append-only, the latest grade counts |
| `audit_criteria` (M3 slice 2, A-083) | key (needGroup, phone, refuseReason), active, weight (1 to 10); the audit's compliance and score are computed from `lead_steps` and these, never stored |
| `consulting_scripts` (M2 slice 6, A-072) | situation_vi, situation_en, answer_vi, answer_en, active, sort_order; the 12 situations of the brief are seeded; never deleted |
| `people` profile columns (M2 slice 6) | address, emergency_contact_name, emergency_contact_phone, customer_group_option_id and customer_group_note (list `customerGroups`, A-070); the staff in charge is `pic_user_id` (A-071); an index on `created_at` for the registration filter |
| `person_merges` (T-065) | survivor_id, merged_id (unique), reason_option_id, reason_note, merged_by, before (the merged record without encrypted values, the conflicting phone and email, the filled fields), created_at; the merged record keeps its row with `merged_into_id` and `merged_at` (no phone), its codes stay reserved (D-038) |
| `lead_status_history` (built as `lead_status_changes`, T-062) | person_id, from_status (null at creation), to_status, appointment_at, reason_option_id, reason_note, note, by (null: the system), at |
| `lead_assignments` (T-062) | person_id, from_user_id, to_user_id, by (null: round-robin and the automatic move), at, kind (ROUND_ROBIN, MANUAL, RECLAIM), waited_minutes (RECLAIM; D-050, D-052) |
| `lead_round_robin` (T-062) | branch_id, last_user_id: the branch's last receiver of a new lead |
| `lead_turns` (M2.7, A-100) | branch_id, user_id, vtime (virtual time of the weighted round-robin); replaces `lead_round_robin`, which stays for the leads dealt before |
| `consulting_checklists` / `consulting_step_templates` (T-063) | version, created_by (no foreign key); step key, order, labels, trigger (ASSIGNED, STATUS, APPOINTMENT, AFTER_STEP, RECARE), trigger status or step, offset minutes, required, auto_complete, results (labels) |
| `consulting_steps` (built as `lead_steps`, T-063) | person_id, template_step_id, opened_at, due_at, due_notified_at, done_at, done_by, result_index, note, timing (ON_TIME, LATE), locked_at (locked as "Không thực hiện", D-054, A-102) |
| `appointments` | person_id, at, assessment_type_option_id, confirmation_1, confirmation_2, outcome (SHOW, NO_SHOW) |
| `recare_queue` | person_id, contact_on, reason, resolved_at |
| `consulting_audits` | person_id, auto_score, compliance_pct, manager_result (PASS, FAIL), manager_note, ai_suggestion (json), audited_by |
| `consulting_scripts` | situation_option_id, text_vi, text_en, active |

### Services and contracts (brief §5)

| Table | Key fields |
|---|---|
| `services` | name, image, kind (PT, CLASS, MEMBER), branches, allowed_hours, commission_rate (percent of the allocation paid to the PT, 100 initially, A-167), is_group, max_members, max_per_week, max_per_day, active_from, active_to, notes |
| `price_tier_versions` | service_id, version, effective_from, created_by; a version is never edited; contracts reference the version they used (A-109) |
| `price_tiers` | version_id, min_sessions, max_sessions (empty: no limit), unit_price, validity_months, validity_days; tiers of one version never overlap (exclusion constraint) |
| `quick_packages` | service_id, sessions |
| `promotions` | kind (PROMOTION, VOUCHER), name, code (vouchers; unique), discount_type (PERCENT, AMOUNT), value, valid_from, valid_to, active; `promotion_services` (none: every service) (A-110) |
| `promotions` | name, kind (PERCENT, AMOUNT), value, from, to, voucher_code |
| `contracts` (M4.4a additions) | approved_by, approved_at, deleted_at, deleted_by, delete_reason_option_id, delete_reason_note; status gains REJECTED; the triggers `contracts_lock`, `contract_staff_shares_lock`, and `contract_companions_lock` refuse changes to an approved contract's commercial columns and parts (A-122) |
| `payments` and `cash_transactions` (M4.5) | `payments` gains receipt_number (unique, from receipt_seq), sale_employee_id, and note; `cash_transactions` gains number (unique: receipt_seq for income, expense_voucher_seq for an expense), payee, method_option_id, method_note, and contract_id (a refund); a payee or contract only on an expense |
| `checkin_devices` (M5.3b) | id, branch_id, name, key_hash (SHA-256 of the key, which is never stored), active, last_seen_at, clock_offset_seconds |
| `checkin_scans` (M5.3b) | id, device_id, branch_id, machine_user_code, scanned_at (real time), received_at, subject_type, customer_id or employee_id, result (WAITING, PAIRED, ERROR, REPEAT), error_code, booking_id; unique (device, code, scanned_at) |
| `customers.machine_user_code`, `employees.machine_user_code` (M5.3b) | the code on the machine, unique; `bookings.customer_scan_id` and `pt_scan_id` (unique: a scan serves one session), `scan_requested_at/by`, `hanging_escalated_at`; `sessions.checked_in_by` may be empty for a device confirmation |
| `classes` (M5.5) | id, branch_id, name, coach_id, capacity, weekdays (ISO 1 to 7), start_time, end_time, active |
| `class_sessions` (M5.5) | id, class_id, branch_id, coach_id, capacity, starts_at, ends_at, status (SCHEDULED or CANCELLED); unique (class, start) |
| `class_attendances` (M5.5) | id, class_session_id, customer_id, contract_id, status (ENROLLED, PRESENT, ABSENT), consumes (= present), enrolled_by/at, marked_by/at; unique (session, customer); a contract's sessions used = its consuming bookings + its consuming attendances (T-050) |
| `bookings.added_by_hand`, `added_reason_option_id`, `added_reason_note` (M5.4) | Burn Show: a session added by hand and why (a CHECK: an added session has a reason); the list `burnShowReasons` |
| `bookings.history_deleted_at`, `history_deleted_by` (M5.4) | a trained session deleted from the check-in history (status `DELETED`); with the session's `completed_at` they feed the PT's payroll adjustment (D-027, M5.7) |
| `sessions.confirmation_method` (M5.3) | `MANUAL` or `DEVICE`; the status `DELETED` (Xóa) is a fifth row of `session_statuses` |
| `session_statuses` (M5.1) | code (key), id, label_vi, label_en, consumes, credits_pt, holds_slot, locks_on_set, color (a design token), sort_order; `bookings.status` is a key of it and `bookings` keep `consumes`, `credits_pt`, `holds_slot`, `status_set_at`, `status_set_by` (A-145) |
| `files` (M4.1b) | id, purpose, content_type, size, sha256, storage_key (unique, never shown), uploaded_by, created_at; `services.image_file_id` and `payments.proof_file_id` point at it (A-143, A-144) |
| `cash_opening_balances` (M4.7) | branch_id, method_option_id (unique together), effective_on, amount (≥ 0), updated_by, updated_at; the cash a branch held in a method when its books begin (A-138) |
| `contract_freezes` (M4.6) | contract_id, frozen_on, frozen_at, frozen_by, reason; how it ended (ended_at, ended_on, ended_by, end reason, frozen_days, added_days, previous_end_date, new_end_date); reminded_at; at most one open per contract (partial unique index). `contracts.status` gains FROZEN |
| `contract_staff_shares` | contract_id, role (PT, SALE), employee_id, percent (A-115) |
| `contract_companions` | contract_id, customer_id (group packages, A-116) |
| `contracts` (as built in M4.3: `total_sessions` is the sessions bought, `package_name` the generated display name, `request_fingerprint` the content of the create request for idempotency, `is_imported` for contracts brought over from before the tiers, which have no service and a flagged price) | code, person_id, service_id, price_tier_id, contract_type (NEW, RENEW), contract_date, sessions_bought, bonus_sessions, bonus_months, bonus_days, display_name (generated), tier_unit_price, approved_unit_price, is_exception_price, exception_reason_option_id, exception_note, promotion_id, discount_pct, discount_amount, total_discount, vat_pct, vat_amount, value, activation_deadline, planned_start, start_date, end_date, previous_contract_id, signed, signed_on, signed_by, status (PENDING_APPROVAL, ACTIVE, FROZEN, ON_HOLD, CANCELLED; EXPIRED derived), approval_status, approved_by, payment_due_on, opening_sessions_used, opening_paid_amount (D-011), legacy_code |
| `contract_members` | contract_id, person_id (companions on group packages, OQ-010) |
| `contract_staff` | contract_id, employee_id, role (PT, SALE), share_pct; check: shares per role sum to 100 |
| `freezes` | contract_id, from, to, freeze_reason, unfreeze_reason, proposed_days, granted_days, decided_by; at most one open freeze per contract |
| `change_vouchers` | code, contract_id, kind (RENEWAL, UPGRADE, HOLD, TRANSFER, BRANCH_TRANSFER, CONVERSION, CANCELLATION), fields per kind (json validated per kind: dates, months, days, sessions, amounts, target person, target branch, new service, paid, used value, fee, refund), approval_status |

### Schedule and classes (brief §6)

| Table | Key fields |
|---|---|
| `sessions` | contract_id, person_id, employee_id (PT), start_at, end_at, status_key, consumes, credits_pt (snapshot, T-050), confirmation (ADMIN_CLICK, MANUAL_ADD, DEVICE), added_by_hand, burn_reason, note, status_set_by, status_set_at; exclusion constraints: no overlap per PT and per person while the status holds the slot (A-024) |
| `pt_payroll_adjustments` | employee_id, session_id, applies_to_period, sessions_delta, amount |
| `classes` | name, coach_employee_id, branch_id, weekdays, start_time, end_time, capacity, active |
| `class_sessions` | class_id, date, coach_employee_id, status |
| `class_enrollments` / `attendance` | class_session_id, person_id, contract_id (nullable for drop-in), status (ENROLLED, PRESENT, ABSENT), consumes (snapshot) |

### Workouts (brief §7)

| Table | Key fields |
|---|---|
| `equipment`, `body_areas` (parent_id), `exercises` (area, equipment, kind STRENGTH/CARDIO, description, video_url), `stages` | catalogs with active flags |
| `plan_templates`, `plan_template_stages`, `plan_template_exercises` | template by stage and exercise |
| `customer_plans` | person_id, contract_id, employee_id, branch_id, date, phase, goal, pt_review, master_review, notes, approval_status |
| `plan_lines` | customer_plan_id, week, session_no, stage_id, exercise_id, set_no, weight, reps, rest, rir, tempo, technique, notes, video; cardio: duration, speed, heart_rate |
| `session_logs` | session_id (unique), stress, stress_note, energy, energy_note, impact_option_id, srpe, srpe_note, energy_after, energy_after_note, summary_option_id, coach_notes |
| `set_results` | session_log_id, plan_line_id, weight, reps, rir; cardio: duration, speed, heart_rate; flag_option_id, action_option_id, note |
| `escalations` | set_result_id, task_id, reviewed_by, reviewed_at, handling_note |

### Money (brief §8.1)

| Table | Key fields |
|---|---|
| `receipts` | number, received_on, person_id, contract_id or change_voucher_id, amount, method_option_id, received_by, sales_employee_id, branch_id, note, proof_file_id, approval_status, idempotency_key; check amount > 0 |
| `expense_vouchers` | number, paid_on, expense_type_option_id, payee, amount, method_option_id, paid_by, branch_id, note, contract_id (refunds), payout_period, payout_employee_id, approval_status, idempotency_key; check amount > 0 |
| `payout_lines` | expense_voucher_id, employee_id, contract_id, period, sessions, amount — unique per session paid, so nothing is paid twice |
| `cash_opening_balances` | branch_id, method_option_id, period_start, amount |

### Tasks and email (brief §8.2, §8.3)

| Table | Key fields |
|---|---|
| `tasks` | branch_id, title, description, assigner_id, assignee_user_id and/or assignee_department_option_id (checks: at least one; a person once accepted), due_at, priority (LOW, NORMAL, HIGH), status (NEW, ACCEPTED, IN_PROGRESS, DONE, CANCELLED), accepted_at, started_at, done_at, cancelled_at, entity_type + entity_id (both or neither), due_soon_notified_at, overdue_notified_at. Built in M1 slice 7 (T-060); system-generated sources arrive with their modules (A-045) |
| `tasks` (M2.7, A-104) | reminder_minutes (its own reminder points; empty for the shared ones); `due_soon_notified_at` is gone |
| `task_reminders` (M2.7, A-104) | task_id, minutes_before, sent_at: which point went out, once; cleared by a new deadline |
| `task_comments` | task_id, author_id, body, mentions (user ids); never edited or deleted |
| `email_templates` | event_key, enabled, subject_vi, body_vi, subject_en, body_en |
| `email_outbox` | person_id, event_key, language, to, subject, body, status (QUEUED, SENT, FAILED), attempts, provider_id, sent_at, error |

## Database-enforced constraints

| Constraint | Rule |
|---|---|
| Unique codes per entity, never reused | D-038; sequences and unique indexes |
| Unique idempotency keys | contracts, receipts, expense vouchers, change vouchers (T-015) |
| Exclusion: no overlapping sessions per PT and per person while the status holds the slot | D-030, T-014, A-024 |
| `end_at > start_at` on sessions | BR-011 |
| Amount > 0 on receipts and expense vouchers | — |
| PT and Sale shares sum to 100 per contract | D-022 (deferred trigger) |
| One open freeze per contract | D-023 |
| Approval decided by someone other than the submitter | D-018 |
| `sessions_bought > 0`, money not negative, `end_date ≥ start_date` on contracts | carried over |
| Trash entries and audit events are insert-only (no `UPDATE`/`DELETE` grants for the app role) | D-035, T-048 |

Overlap constraint pattern (as in migration `20261010013008_bookings`, applied per PT and per person):

```sql
ALTER TABLE "sessions" ADD CONSTRAINT "session_pt_no_overlap"
  EXCLUDE USING gist ("employee_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&)
  WHERE ("holds_slot" AND "deleted_at" IS NULL);
```

`holds_slot` is stored with the status snapshot (A-024), because the exclusion predicate must be immutable. The customer has the same constraint, `booking_customer_no_overlap` on `customer_id` (M5.2, migration `20261016010000_customer_overlap`).

## Derived values

| Value | Formula |
|---|---|
| Sessions total | sessions bought + bonus sessions + change-voucher adjustments (renewal, upgrade, transfer) |
| Sessions used | opening sessions used (D-011) + COUNT(sessions with `consumes`) + COUNT(attendance with `consumes`) |
| Sessions left | total − used |
| Paid | opening paid amount + SUM(valid receipts) — valid means approved and not deleted |
| Debt | contract value (after discounts and VAT) − paid |
| Contract *Expired* | status ACTIVE and end date (plus granted freeze and hold days) before today |
| PT credited sessions | COUNT(sessions with `credits_pt`) per PT, contract, and period, plus adjustments |
