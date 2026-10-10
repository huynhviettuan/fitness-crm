# 08 — UI/UX Specification

Visual design, components, languages, and formatting rules are defined in `23_UI_DESIGN_SYSTEM.md`. This document defines the screens.

The UI is available in Vietnamese and English (T-027). Each user switches language from the user menu.

## Navigation proposal

```text
Dashboard
Customers
Contracts
PT Calendar
Sessions
Finance
Reports
Administration
```

The top bar has a global customer search (Ctrl+K, by code/name/phone) and the user menu (name, role, language, sign out). See `23_UI_DESIGN_SYSTEM.md` §6.

## Screen 1 — Login

Fields:

- username/email
- password

Actions:

- Sign in

## Screen 2 — Dashboard

Cards:

- Today's bookings
- Checked in
- Completed
- Cancelled
- No-show
- Collected this month
- Outstanding debt
- Expenses

Widgets:

- PT sessions by trainer
- Recent payments
- Contracts running out of sessions (D-012)

## Screen 3 — Customer List

Capabilities:

- search by code/name/phone
- pagination
- quick status
- create customer

Columns:

- customer code
- full name
- phone
- active contract count
- remaining sessions summary
- debt summary

## Screen 4 — Customer Detail

Header:

- customer ID/code
- name
- phone
- status

Tabs:

- Overview
- Contracts
- Bookings
- Sessions
- Payments

Bookings and their sessions share one tab, since a session is the fulfillment of a booking (T-011).

## Screen 5 — Contract Detail

Show:

- contract code
- package
- total / completed / remaining sessions
- start/end date
- contract value
- paid
- debt
- payment history
- session history

## Screen 6 — PT Booking Calendar

Layout (`TrainerScheduleGrid`, see `23_UI_DESIGN_SYSTEM.md` §9):

- date selector
- trainer filter
- time grid: trainers as columns, 30-minute rows
- booking blocks colored by status

Actions:

- add booking
- open booking detail
- reschedule
- cancel
- check in
- complete
- mark no-show

## Screen 7 — Session Operations

Useful views:

- today
- upcoming
- checked in
- completed
- no-show
- cancelled

## Screen 8 — Finance

Tabs:

- Contract Payments
- Debt
- Income / Expense

Payments and income/expense show one month at a time, with the month's totals. Contract payments and other income are separate lines, with no net figure, until OQ-007 is answered. The debt list shows contracts that still owe money, largest first (A-022).

## Screen 9 — Reports

Minimum reports:

- Session report
- PT report
- Contract/payment/debt report
- Income/expense report

## UX rules

- Critical actions must show clear confirmation (`ConfirmDialog`).
- Disable a critical action's submit button while the request is pending. This is a convenience; the server-side idempotency key (T-015) is what prevents duplicates.
- Voiding a payment or cash transaction asks for a reason.
- Session completion should display the contract's new remaining-session count.
- Money amounts must use consistent currency formatting (`Money`), and dates and times the gym timezone (`DateTime`).
- Statuses are shown with `StatusBadge`; lists use `DataTable`; empty lists show `EmptyState`.
- Avoid copying the dense navigation pattern from legacy gym software; prefer a simple sidebar/top-level navigation.
