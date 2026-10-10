# 10 — Reporting & Dashboard

## Dashboard KPIs

### Operational — Today

- total bookings
- checked-in sessions
- completed sessions
- upcoming sessions
- cancelled bookings
- no-shows

### Contracts

- active contracts
- contracts ending soon: few remaining sessions, not a near end date (D-012, A-023)
- total remaining PT sessions

### Finance — Current month

- contract value created
- confirmed amount collected
- outstanding debt
- income
- expense
- net cash flow

### Trainer performance

- bookings per trainer
- completed sessions per trainer
- no-show/cancel counts

## Report 1 — Session Report

Columns:

- date
- customer code
- customer name
- contract code
- PT
- scheduled start/end
- check-in time
- completed time
- final status

## Report 2 — Trainer Report

Columns:

- trainer
- booked sessions
- completed sessions
- cancelled
- no-show

## Report 3 — Contract / Debt Report

Columns:

- customer
- contract
- contract value
- confirmed paid amount
- debt
- total sessions
- completed
- remaining
- start/end date

## Report 4 — Finance Report

Columns:

- date
- transaction type
- category
- reference
- income
- expense
- created by

## Data consistency

Dashboard values must use the same source-of-truth queries as report values. Avoid duplicating business formulas in the frontend.

- "Today" and "current month" are calculated in the gym timezone (A-001).
- "Active contracts" excludes contracts that are derived as `EXPIRED` (T-018).
- Completed-session counts come from booking status (T-012).
- Whether contract payments are counted as income is open (OQ-007). Until it is answered, report confirmed payments and cash income as separate lines.
