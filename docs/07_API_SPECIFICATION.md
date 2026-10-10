# 07 — API Specification

Base path proposal: `/api/v1`

## Authentication

Login, logout, and session cookies are handled by the authentication library (Better Auth, T-028: `/api/auth/*`), outside `/api/v1` (T-016).

```http
GET  /auth/me
```

Returns the current user: id, name, role, and linked trainer id (if any). Every protected endpoint rejects a disabled account (T-017).

## Request requirements

State-changing requests (POST, PATCH, PUT, DELETE) must:

- carry an `Origin` header equal to the app's own origin, as browsers do automatically. Other origins, or a missing `Origin`, get `403 FORBIDDEN` (T-033).
- send a JSON body with `Content-Type: application/json`. Anything else gets `415 UNSUPPORTED_MEDIA_TYPE`.

A future mobile or integration client will need its own authentication (e.g. tokens) rather than browser cookies; revisit this rule when one is added.

## Idempotency

These requests must include an `Idempotency-Key` header containing a client-generated UUID (T-015):

```http
POST /customers/:customerId/contracts
POST /contracts/:contractId/payments
POST /cash-transactions
```

- First request → `201` with the created record.
- Same key, same payload → `200` with the original record; nothing new is created.
- Same key, different payload → `409 IDEMPOTENCY_KEY_REUSED`.
- Missing key → `400 IDEMPOTENCY_KEY_REQUIRED`.

Server Actions pass the same key as a hidden form field generated when the form is rendered, so a double-click or retry reuses it.

Status-transition endpoints (check-in, complete, cancel, no-show, void) need no key. They are idempotent by state: repeating a transition that already happened returns `200` with the current state.

## Customers

```http
GET    /customers
POST   /customers
GET    /customers/:id
PATCH  /customers/:id
```

Query examples:

```text
GET /customers?search=0909&page=1&pageSize=20
```

## Contracts

```http
GET    /customers/:customerId/contracts
POST   /customers/:customerId/contracts
GET    /contracts/:id
PATCH  /contracts/:id
POST   /contracts/:id/activate
POST   /contracts/:id/cancel
```

Contract response should include derived summary:

```json
{
  "status": "ACTIVE",
  "totalSessions": 24,
  "completedSessions": 9,
  "remainingSessions": 15,
  "contractValue": 12000000,
  "confirmedPaidAmount": 8000000,
  "debt": 4000000
}
```

`status` is the effective status, so it is `EXPIRED` when an `ACTIVE` contract is past its end date (T-018). The response also carries `openingSessionsUsed`, `openingPaidAmount` (D-011), and `paidAmount` (opening plus confirmed payments).

Request body for create and `PATCH` (all fields, as typed in the form): `packageName`, `contractValue` (whole VND, e.g. `"12.000.000"` or `12000000`), `totalSessions` (1–1000), `startDate`, `endDate` (`dd/MM/yyyy`, end on or after start). Code, status, and opening balances are never accepted.

- New contracts start as `DRAFT`. `PATCH` works on drafts only (OQ-015 interim, `CONTRACT_NOT_EDITABLE`).
- `activate`: `DRAFT` → `ACTIVE`. `cancel`: `DRAFT` or `ACTIVE` → `CANCELLED`; an expired contract cannot be cancelled. Repeating a transition returns the current state.
- `cancel` also cancels every `BOOKED` booking of the contract (D-010, A-018), and is refused with `CONTRACT_HAS_CHECKED_IN_BOOKING` while one of its bookings is checked in.
- Who may do what: A-015.

## Trainers

```http
GET   /trainers              # ?activeOnly=true: only trainers taking bookings
POST  /trainers
PATCH /trainers/:id
```

Request body for create and `PATCH` (all fields): `fullName`, `status` (`ACTIVE` or `INACTIVE`, default `ACTIVE`), `userId` (a login with the `TRAINER` role, or `""` for none; A-010). The trainer code (`PT` + 3 digits) is generated and never accepted. Creating and editing trainers is Admin and Manager (A-016).

## Bookings

```http
GET    /bookings
POST   /bookings
GET    /bookings/:id
PATCH  /bookings/:id
POST   /bookings/:id/cancel
POST   /bookings/:id/no-show
```

Create payload, as typed in the form (T-038):

```json
{
  "customerId": "uuid",
  "contractId": "uuid",
  "trainerId": "uuid",
  "date": "10/10/2026",
  "startTime": "18:00",
  "endTime": "19:00"
}
```

- `date` is `dd/MM/yyyy`; the times are `HH:mm` on that day in the gym timezone (A-001, A-019). The end must be after the start (BR-011).
- Status and session facts are never accepted. There is no `Idempotency-Key` (T-037).
- `PATCH /bookings/:id` (reschedule) takes `trainerId`, `date`, `startTime`, `endTime`; the customer and contract never change.
- `GET /bookings` filters: `from`, `to` (gym days, inclusive, `dd/MM/yyyy`), `status`, `trainerId`, `customerId`, `contractId`, `order` (`asc` or `desc` by start), `page`, `pageSize`.
- A booking response has `scheduledStart` and `scheduledEnd` as UTC instants, the customer, the contract (with `remainingSessions`), the trainer, the status, and the session facts (`checkedInAt`, `checkedInBy`, `completedAt`, `completedBy`) once checked in.
- A Trainer sees and changes only bookings of their own trainer record (A-007); other bookings are `404`.

Allowed from these booking statuses (A-006):

| Action | From status |
|---|---|
| `PATCH /bookings/:id` (reschedule) | `BOOKED` |
| `POST /bookings/:id/cancel` | `BOOKED`, `CHECKED_IN` |
| `POST /bookings/:id/no-show` | `BOOKED` |

Create and reschedule re-validate trainer overlap (BR-010), time validity (BR-011), and contract validity (BR-003, BR-012). Create also refuses a contract whose open bookings already cover its remaining sessions (OQ-008 interim).

## Sessions

```http
POST /bookings/:bookingId/check-in
POST /bookings/:bookingId/complete
```

Check-in moves the booking from `BOOKED` to `CHECKED_IN` and creates its session record. A repeat returns the current state.

Completion must be idempotent, including under concurrent requests (see `22_TECHNICAL_ARCHITECTURE.md` §7).

Recommended behavior:

- First valid completion → `200`, booking becomes COMPLETED, one session consumed.
- Repeated completion → `200` returning the same completed state, no additional consumption.
- The response is `{ "booking": …, "contract": … }`: the completed booking and the contract with its new remaining-session count.

## Payments

```http
GET   /contracts/:contractId/payments
POST  /contracts/:contractId/payments
POST  /payments/:id/void
```

Request body for record: `amount` (whole VND greater than 0, e.g. `"5.000.000"`), `method` (`CASH`, `BANK_TRANSFER`, `CARD`, `E_WALLET`; A-020), `paidOn` (`dd/MM/yyyy`, not later than today; T-039). Status, contract, and who recorded it are never accepted.

- A payment that would take the paid amount (opening balance plus confirmed payments) above the contract value is refused with `PAYMENT_EXCEEDS_CONTRACT_VALUE` (OQ-003 interim).
- A cancelled contract takes no payment: `PAYMENT_CONTRACT_CANCELLED` (OQ-013 interim). Draft and expired contracts do.
- `GET /contracts/:contractId/payments` lists the contract's payments, voided ones included.
- Who may: `09_RBAC.md` and A-021.

Void requires a reason:

```json
{ "reason": "Entered against the wrong contract" }
```

A voided payment stops counting toward the paid amount, stays on record, and is never reinstated (A-008). Repeating a void returns the voided payment.

## Cash transactions

```http
GET  /cash-transactions
POST /cash-transactions
POST /cash-transactions/:id/void
```

Request body for record: `type` (`INCOME` or `EXPENSE`), `category` (free text, OQ-016), `amount` (whole VND greater than 0), `occurredOn` (`dd/MM/yyyy`, not later than today), and optional `reference` and `description`. `GET /cash-transactions` filters: `from`, `to` (gym days, inclusive), `type`, `status`, `page`, `pageSize`.

Void requires a reason. To correct an entry, void it and record a new one (A-009).

## Dashboard / reports

```http
GET /dashboard/summary?from=...&to=...
GET /reports/sessions?from=...&to=...
GET /reports/trainers?from=...&to=...
GET /reports/contracts?from=...&to=...
GET /reports/finance?from=...&to=...
```

Date-only `from`/`to` values are interpreted in the gym timezone (A-001).

## Error contract

```json
{
  "code": "CONTRACT_NO_REMAINING_SESSIONS",
  "message": "The contract has no remaining sessions",
  "details": {}
}
```

Use stable machine-readable error codes.

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Input fails schema validation |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | A create that requires a key has none |
| `UNAUTHENTICATED` | 401 | No valid session, or the account is disabled |
| `FORBIDDEN` | 403 | Role or ownership does not allow the action |
| `NOT_FOUND` | 404 | Entity does not exist or is not visible to the user |
| `INVALID_STATUS_TRANSITION` | 409 | Action not allowed from the current status |
| `CONTRACT_NOT_ACTIVE` | 409 | Contract is draft, cancelled, or expired |
| `CONTRACT_NO_REMAINING_SESSIONS` | 409 | Completion (or booking, under OQ-008 interim) with no sessions left |
| `BOOKING_TRAINER_OVERLAP` | 409 | Trainer already has an active booking in that time range |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key sent with a different payload |
| `EMAIL_ALREADY_USED` | 409 | A user with this email already exists |
| `CONTRACT_NOT_EDITABLE` | 409 | Editing a contract that is no longer a draft (OQ-015) |
| `CONTRACT_HAS_CHECKED_IN_BOOKING` | 409 | Cancelling a contract while one of its bookings is checked in (D-010) |
| `PAYMENT_CONTRACT_CANCELLED` | 409 | Recording a payment on a cancelled contract (OQ-013 interim) |
| `CANNOT_CHANGE_OWN_ACCESS` | 409 | An admin tried to change their own role or status (A-014) |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | A request body that is not `application/json` |
| `BOOKING_CUSTOMER_CONTRACT_MISMATCH` | 422 | Booking customer does not own the contract (OQ-010) |
| `BOOKING_OUTSIDE_CONTRACT_PERIOD` | 422 | Booking or completion outside the contract dates (OQ-001) |
| `PAYMENT_EXCEEDS_CONTRACT_VALUE` | 422 | Payment would exceed contract value (OQ-003 interim) |
| `INTERNAL_ERROR` | 500 | Unexpected failure; details are logged on the server, never returned |

Codes are added to `src/lib/errors/app-error.ts`, this table, and the `errors` section of `messages/*.json` together.

## V1 implementation note

The `/api/v1` contract is implemented using **Next.js Route Handlers** inside the same Vercel-deployed application. It is a logical API boundary, not a separate NestJS service.

UI-specific mutations may also use Server Actions, but Server Actions and Route Handlers must reuse the same application/domain services so business rules are not duplicated.
