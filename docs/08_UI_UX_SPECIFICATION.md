# 08 — UI/UX Specification

Visual design, components, languages, and formatting are in `23_UI_DESIGN_SYSTEM.md`. Wireframes for the four key screens are in `docs/wireframes/flow-fitness-wireframes.html`. The UI is Vietnamese, ready for English (D-043). Menus and buttons a user lacks permission for are hidden (D-017).

## Navigation

```text
Tổng quan (Dashboard)
Lead & Tư vấn: Kanban, Danh sách, Việc hôm nay, Tái chăm sóc, Kịch bản
Khách hàng
Hợp đồng: Danh sách, Chờ duyệt, Phiếu biến động
Lịch: Lịch PT, Lịch lớp
Giáo án: Giáo án khách, Template, Danh mục, Escalation
Sổ quỹ: Phiếu thu, Phiếu chi, Chi trả HLV, Sổ quỹ, Công nợ
Giao việc
Báo cáo
Quản trị: Người dùng, Vai trò, Ma trận duyệt, Chi nhánh, Nhân viên, Danh mục lựa chọn, Tham số, Dịch vụ & bậc giá, Mẫu email, Thùng rác, Nhật ký thao tác
```

The top bar holds the branch switcher (for users with several branches), global customer search (Ctrl+K), the notification bell, the approvals inbox, and the user menu.

## Shared list template (brief §1)

Filters on the left, a search box, a data table with paging and a **totals row**, and **Add** and **Export Excel** buttons. Masked fields appear as "•••" (D-017).

## Screens

| # | Screen | Content | Brief |
|---|---|---|---|
| 1 | Login | Email and password; refused outside allowed hours | §2 |
| 2 | Overview dashboard | New leads, conversion rate, members training, active PTs, contracts ending soon, PT sessions by hour, revenue by month and year | §9 |
| 3 | Leads — Kanban and list | Columns by status; cards with name, channel, need, PIC, next step due; quick-add form; duplicate warning | §4.1 |
| 4 | Lead detail | Profile, checklist with due times and drop-down results, timeline, notes, appointments, scripts panel with copy, "Convert to customer" | §4.1 |
| 5 | Today's tasks (consultant) | Due and overdue steps across leads | §4.1 |
| 6 | Re-care list | Sorted by contact-again date | §4.1 |
| 7 | Consulting audit | Lead timeline with step timing, auto score, manager pass/fail and comment | §4.1 |
| 8 | Customer list and detail | Filters (branch, staff, registration, birthday, end date, status); tabs: Information, Contracts and services, Payment history, Workout plans, Session logs and progress, Consulting history, Emails sent | §4.2 |
| 9 | Contract form | Groups: Service, Duration, Staff (PT and Sale with %), Signature, Price (computed from tier, promotion, discounts, VAT, bonus), First payment; exception price with reason | §5.2 |
| 10 | Contract list and detail | Columns and totals per FR-CON-004; tabs Information, Check-in history, Package history; actions Pay, Print, Note, Deactivate, Unapprove, Delete | §5.3 |
| 11 | Approvals inbox | Pending requests by type with diff of the change; approve or reject with reason | §2 |
| 12 | Change voucher forms | One form per kind (renewal, upgrade, hold, transfer, branch transfer, conversion, cancellation) | §5.6 |
| 13 | PT calendar | One row per PT with session count, 30-minute columns 05:00–22:00, green bookable and grey unavailable cells, colored session blocks, day and week view, filters (branch, date, PT, customer); session detail dialog with actions; bulk "Đã tập" for admin; works on phones (one PT, vertical day list) | §6.1–§6.2 |
| 14 | Check-in history (contract tab) | Sessions with status, slot, PT, confirmation method, note; delete with reason; Burn Show form | §6.3 |
| 15 | Class schedule | Grid by day and week; class detail with enrollment and attendance | §6.4 |
| 16 | Workout plan editor | Stages, exercises from the catalog, set targets; cardio rows show time, speed, heart rate | §7.2 |
| 17 | Session log (phone first) | Pre-session scales, set rows with plan and actual side by side, Flag and Action drop-downs, post-session scales and notes | §7.3 |
| 18 | Escalations | Open escalations with link to the session; mark reviewed with a handling note | §7.4 |
| 19 | Cash book | Receipts, expense vouchers, PT payouts from an allocation period, cash book per day and period with balances, member debt | §8.1 |
| 20 | Tasks | My tasks, tasks I assigned, by department; task detail with comments and the linked record | §8.2 |
| 21 | Reports | One page per report of doc 10, each with filters and Excel export | §9 |
| 22 | Administration | Users (tabs Information, Permissions, Access hours, Login history), roles with the permission tree, data scope, masks, thresholds, approval matrix, branches, employees and PT schedules, option lists with "Khác" statistics, parameters, session status rules and colors, services and tiers, promotions, email templates, trash, action history | §2, §8 |

## UX rules

- Results, reasons, and categories are drop-downs; choosing "Khác" opens a required note field (D-016).
- Critical actions (Đã tập, delete, deactivate, approve, cancel, void-like deletions of vouchers) use `ConfirmDialog` stating the effect, e.g. "Sessions left: 16 → 15".
- Pending records show a "Chờ duyệt" badge and cannot be used until approved.
- Disable submit buttons while saving; idempotency keys protect duplicates (T-015).
- Money with `Money`, dates and times with `DateTime` in the gym timezone.
- Leads, the PT calendar, and the session log are designed phone-first: large touch targets, defaults prefilled (actuals = plan, Flag Normal, Action None).
