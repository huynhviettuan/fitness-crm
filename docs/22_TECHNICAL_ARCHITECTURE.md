# 22 — Technical Architecture

## 1. Architecture decision

Fitness CRM V1 uses a **single full-stack Next.js application** deployed to **Vercel**.

```text
Users
  |
  v
Vercel
└── Next.js App Router
    ├── Client Components
    ├── Server Components
    ├── Server Actions
    ├── Route Handlers (/api/v1)
    ├── Application / Domain Services
    ├── Repositories
    └── Prisma Client
             |
             v
        PostgreSQL
```

No NestJS, Express, Railway, Render, microservice, Redis, or queue infrastructure is part of the V1 baseline.

## 2. Why a single application

The product is an internal CRM for one gym. Its current critical flows are transactional CRUD/business workflows rather than high-volume distributed workloads.

A single deployment provides:

- simpler development
- one authentication boundary
- no browser-to-separate-API CORS problem
- fewer deployment/configuration surfaces
- easier preview deployments
- faster AI-agent iteration

The system must still be structured as modular application code so the backend can be extracted later if required.

## 3. Logical layers

### Presentation layer

Includes:

- pages/layouts
- React components
- forms/tables/calendar/dashboard UI

Responsibilities:

- render data
- collect user input
- show validation/business errors
- invoke server boundaries

It must not own core business rules.

### Server boundary layer

Includes:

- Server Actions
- Route Handlers under `/api/v1`

Responsibilities:

- authenticate user
- enforce coarse authorization
- parse and validate input
- call application/domain service
- convert domain errors into UI/API responses

Keep this layer thin.

### Application/domain service layer

Examples:

```text
CustomerService
ContractService
BookingService
SessionService
PaymentService
ReportingService
```

Responsibilities:

- business rules
- state transitions
- transaction orchestration
- idempotency rules
- authorization rules that depend on domain context
- audit-event orchestration

This is the most important layer for correctness.

### Repository/data-access layer

Responsibilities:

- Prisma queries
- persistence concerns
- transaction-aware data access
- query composition

Business decisions must not be hidden in repository queries.

### Database

PostgreSQL is the source of truth for operational and financial data.

Prisma is used for schema/migrations and data access.

## 4. Suggested repository structure

```text
fitness-crm/
├── messages/
│   ├── vi.json
│   └── en.json
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   ├── (crm)/
│   │   │   ├── dashboard/
│   │   │   ├── customers/
│   │   │   ├── contracts/
│   │   │   ├── bookings/
│   │   │   ├── finance/
│   │   │   └── reports/
│   │   └── api/
│   │       └── v1/
│   ├── components/
│   │   └── ui/          # generated shadcn/ui components
│   ├── i18n/
│   ├── modules/
│   │   ├── customers/
│   │   ├── contracts/
│   │   ├── bookings/
│   │   ├── sessions/
│   │   ├── trainers/
│   │   ├── finance/
│   │   └── reporting/
│   ├── lib/
│   │   ├── auth/
│   │   ├── db/
│   │   ├── errors/
│   │   ├── permissions/
│   │   └── validation/
│   └── generated/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/
├── e2e/
├── docs/
├── AGENTS.md
├── README.md
└── package.json
```

Exact paths may change, but the dependency direction must remain clear.

## 5. Dependency direction

Preferred:

```text
UI
  -> Server Boundary
      -> Service
          -> Repository
              -> Prisma/PostgreSQL
```

Avoid:

```text
React Component -> Prisma
Route Handler -> 200 lines of business logic
Repository -> decides business state transition
Client -> calculates authoritative debt/session balance
```

## 6. Server Actions vs Route Handlers

Use **Server Actions** when the action is tightly coupled to this web UI and does not need to be an external/stable HTTP contract.

Use **Route Handlers** when:

- the operation belongs to the documented `/api/v1` contract
- Playwright/API integration tests benefit from direct HTTP access
- a future mobile/integration client may need the endpoint
- webhooks/integrations need a URL

Both must call the same service layer. Do not duplicate business logic between them.

## 7. Transactions, concurrency, and idempotency

Money and session consumption changes must be atomic **and** correct when two requests arrive at the same time. A check made before the transaction starts, or without a lock, is not enough: two concurrent requests can both pass it.

### Complete session (T-013)

```text
Request: complete booking B
  -> authenticate; validate input; coarse authorization
  -> read B.contract_id (no lock)
  -> BEGIN
       SELECT contract ... FOR UPDATE        -- serializes all completions on this contract
       SELECT booking B ... FOR UPDATE
       if B.contract_id changed: ROLLBACK and retry
       if B.status = COMPLETED:
            COMMIT; return existing state    -- idempotent replay: no consumption, no new audit event
       if B.status != CHECKED_IN: reject INVALID_STATUS_TRANSITION   (OQ-002)
       domain authorization (e.g. trainer owns B)
       if total_sessions - opening_sessions_used
            - COUNT(COMPLETED bookings of contract) <= 0:     -- D-011
            reject CONTRACT_NO_REMAINING_SESSIONS
       UPDATE booking SET status = 'COMPLETED'
         WHERE id = B AND status = 'CHECKED_IN'   -- must affect exactly 1 row
       set session.completed_at / completed_by
       insert audit event
     COMMIT
  -> return booking + contract summary (new remaining count)
```

Why each step matters:

- **The contract lock** prevents two completions of *different* bookings from both taking the last remaining session (BR-009). The default READ COMMITTED isolation is sufficient: every statement after the lock sees rows committed by the previous lock holder.
- **The booking lock and conditional update** prevent the *same* booking from being completed twice (BR-007).
- **Lock order** is always contract → booking. Every operation that locks both must use this order to avoid deadlocks. Any operation that changes a contract's completed count or `total_sessions` must take the same contract lock.

### Other critical writes

| Operation | Safety mechanism |
|---|---|
| Check-in | Conditional update `BOOKED → CHECKED_IN`; unique `session.booking_id`. A repeat returns the existing state. |
| Create / reschedule booking | Service pre-check plus the database exclusion constraint (T-014). Map SQLSTATE `23P01` to `BOOKING_TRAINER_OVERLAP`. |
| Create contract, payment, cash transaction | Required idempotency key with a unique constraint (T-015). |
| Cancel, no-show, void | Conditional status update. A repeat returns the existing state. |

Every one of these writes its audit event in the same transaction (T-022).

Every booking change in the table also takes the contract lock first, then the booking lock, and so does cancelling a contract (T-036). Recording or voiding a payment takes the contract lock too, and checks the idempotency key again under it, so a double submit is a replay rather than an overpayment (T-040). Creating a booking needs the contract lock for the OQ-008 interim count; check-in needs it so it cannot slip in while the contract is being cancelled (D-010).

### Prisma notes

- Prisma has no `FOR UPDATE` API. Repositories take row locks with `$queryRaw` inside an interactive `$transaction(async (tx) => ...)`.
- Keep interactive transactions short and set an explicit `timeout`. Do no network calls or slow work inside them.
- Pooled connections (PgBouncer transaction mode) keep a whole transaction on one server connection, so row locks behave correctly.
- Prisma reports an exclusion-constraint violation as `P2039`, with the SQLSTATE `23P01` in `meta.driverAdapterError.cause.code`. `isExclusionViolation` in `src/lib/db/errors.ts` recognizes it.

## 8. Derived values

Do not trust mutable client values for:

- remaining sessions
- completed sessions
- confirmed paid amount
- debt

Compute/derive these from authoritative records according to the business rules:

- completed sessions come from booking status (T-012);
- `EXPIRED` contract status is derived from `end_date` and the gym timezone (T-018).

Caching derived values is allowed later only if correctness and invalidation are explicitly designed.

## 9. Authentication and authorization

Authentication runs server-side.

Authorization must be enforced at the server mutation/query boundary and/or service layer. Hiding a UI button is not authorization.

Every protected request loads the current user from the database and rejects `DISABLED` accounts. Role and account status are not trusted from the session token alone (T-017).

Login, logout, and session routes belong to the authentication library, outside `/api/v1` (T-016).

Roles are defined in `09_RBAC.md`; the permission matrix lives in `src/lib/permissions/` (T-020).

## 10. Vercel and database considerations

- centralize Prisma client creation
- use a managed PostgreSQL connection strategy suitable for serverless/elastic execution
- avoid unbounded connection creation
- keep request handlers short
- do not rely on in-memory process state across requests
- do not assume one Vercel instance handles consecutive requests

Business state must live in PostgreSQL, not process memory.

## 11. Background jobs

V1 should avoid unnecessary queue/worker infrastructure.

If a future feature needs durable asynchronous work, evaluate the workload first. Do not emulate a durable queue with in-memory state or fragile request-time loops.

## 12. API compatibility

The internal API proposal remains under:

```text
/api/v1
```

This gives the project a stable seam for future mobile apps, messaging integrations, or backend extraction.

## 13. Extraction path if the system grows

Future architecture may become:

```text
Next.js / Vercel
       |
       v
Dedicated API / Worker Runtime
       |
       v
PostgreSQL
```

The service/repository boundaries in V1 are intended to make that extraction incremental rather than a rewrite.

## 14. Architecture definition of done

A feature conforms to the V1 architecture when:

- it does not add an unapproved runtime/service
- client components contain no authoritative business logic
- server input is validated
- server authorization exists
- business rules live in services
- Prisma access is centralized through approved data-access boundaries
- critical multi-record mutations use transactions
- critical money/session mutations are safe under concurrent and repeated requests (§7)
- critical money/session mutations have tests and audit behavior
