# 06 — Functional Requirements

## Customer

### FR-CUS-001
The system shall create a customer with a unique customer code.

### FR-CUS-002
The system shall search customers by customer code, name, and phone.

### FR-CUS-003
The system shall show a customer detail page containing contracts, bookings, sessions, and payments.

### FR-CUS-004
Authorized users shall update editable customer information.

## Contract

### FR-CON-001
Authorized users shall create a contract for a customer.

### FR-CON-002
A contract shall store contract code, package name, value, total sessions, effective dates, and status.

### FR-CON-003
The system shall show purchased, completed, and remaining sessions.

### FR-CON-004
The system shall show total confirmed payments and current debt.

## Booking

### FR-BOO-001
Authorized users shall create a booking for customer + contract + PT + time range.

### FR-BOO-002
The system shall prevent trainer time overlap.

### FR-BOO-003
Authorized users shall reschedule or cancel an eligible booking.

### FR-BOO-004
The calendar shall filter by date and trainer.

## Session

### FR-SES-001
Authorized users shall manually check in a booked customer.

### FR-SES-002
Authorized users shall mark a checked-in session as completed.

### FR-SES-003
Completion shall consume exactly one session once.

### FR-SES-004
Authorized users shall mark no-show without consuming a session in V1.

## Payments

### FR-PAY-001
Authorized users shall record contract payments.

### FR-PAY-002
The contract view shall show payment history.

### FR-PAY-003
The system shall calculate paid amount and debt from confirmed payments.

## Cash Transactions

### FR-CASH-001
Authorized users shall record income and expense entries.

### FR-CASH-002
The system shall report income and expense totals for a selected date range.

## Dashboard

### FR-DASH-001
The dashboard shall show today's bookings by status.

### FR-DASH-002
The dashboard shall show completed sessions for today/current period.

### FR-DASH-003
The dashboard shall show revenue/collection/debt/expense summaries.

### FR-DASH-004
The dashboard shall show PT activity/performance summary.

## Admin & Audit

### FR-ADM-001
Admin shall manage users and roles.

### FR-AUD-001
The system shall record audit events for critical actions.
