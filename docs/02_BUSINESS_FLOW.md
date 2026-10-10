# 02 — Business Flow

## Flow 1 — Customer and contracts

```mermaid
flowchart TD
    A[Create Customer] --> B[Generate Unique Customer ID]
    B --> C[Create Contract]
    C --> D{More contracts?}
    D -->|Yes| C
    D -->|No| E[Customer 360 View]
```

### Example

Customer `KH000123` can have:

- `HD000001` — PT 24 sessions
- `HD000002` — PT 12 sessions
- `HD000003` — another package later

The customer ID identifies the person. Contract IDs identify separate commercial agreements. Code formats are A-003.

## Flow 2 — Booking lifecycle and session consumption

The status belongs to the booking (T-011). A session record is created at check-in and stores who checked in and completed the session, and when.

```mermaid
stateDiagram-v2
    [*] --> BOOKED
    BOOKED --> BOOKED: reschedule
    BOOKED --> CHECKED_IN: manual check-in
    BOOKED --> CANCELLED: cancel
    BOOKED --> NO_SHOW: no show
    CHECKED_IN --> COMPLETED: trainer/reception confirms
    CHECKED_IN --> CANCELLED: exceptional cancel
    COMPLETED --> [*]
    CANCELLED --> [*]
    NO_SHOW --> [*]
```

Actions are allowed only from the statuses shown (A-006). Completion directly from `BOOKED` is open (OQ-002).

### Consumption rule

Only `COMPLETED` consumes one session.

Example:

- Purchased: 24
- Completed before today: 8
- Today's booking created: remaining still 16
- Check-in: remaining still 16
- Complete today's session: remaining becomes 15

## Flow 3 — Finance and debt

```mermaid
flowchart LR
    C[Contract Value] --> D[Debt]
    P1[Confirmed Payment 1] --> P[Paid Amount]
    P2[Confirmed Payment 2] --> P
    P --> D
```

Formula:

```text
paid_amount = opening_paid_amount + SUM(confirmed contract payments)
debt = contract_value - paid_amount
```

## Flow 4 — Reporting

Operational and finance data feed management reporting:

```mermaid
flowchart LR
    S[Completed Sessions] --> R[Reports]
    B[Bookings] --> R
    P[Payments] --> R
    E[Expenses] --> R
    C[Contracts] --> R
    R --> D[Dashboard]
```
