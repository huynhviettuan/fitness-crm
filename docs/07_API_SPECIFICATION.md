# 07 — API Specification

The API is the NestJS app `apps/api`, under `/api/v1`, described by **OpenAPI** generated from the controllers (T-041, T-043). The OpenAPI document is the contract: the web app's client is generated from it, and the future member app, ERP modules, and check-in devices use it too. This page states the conventions and the resource map; field-level detail lives in the OpenAPI document.

## Conventions

| Topic | Rule |
|---|---|
| Authentication | The web app uses a Better Auth cookie session (httpOnly, SameSite). Devices and the member app use tokens or API keys later (T-044). `GET /me` returns the user, branches, effective permissions, and masks. |
| Authorization | Each endpoint declares a permission key, checked with branch access, login hours, and data scope; masked fields are removed from responses and exports (T-046). Unknown or out-of-scope records are `404`. |
| Request requirements | State-changing requests need the app's `Origin` and a JSON body (`403`, `415` otherwise) (T-033). |
| Validation | Zod schemas from `packages/shared`; errors return field keys that map to translated messages. |
| Idempotency | `Idempotency-Key` header (UUID) on creating contracts, receipts, expense vouchers, and change vouchers: first `201`, replay `200`, same key with other content `409 IDEMPOTENCY_KEY_REUSED`, missing `400` (T-015). |
| Status changes | Idempotent by state: repeating a transition that already happened returns `200` with the current state. |
| Approvals | Actions under the approval matrix return `202` with the pending record and its approval request; `POST /approvals/:id/approve` and `/reject` (reason) decide. |
| Deletion | `DELETE` takes a body `{ "reasonId", "reasonNote" }` (an option of "deleteReasons"; "Khác" needs the note), moves the record to the trash (D-035), and answers 204. A deleted record is `404` from then on. |
| Lists | `page`, `pageSize`, `sort`, filters per resource; responses carry `items`, `total`, and `totals` (for the totals row). `GET …/export` returns the same filter as an Excel file. |
| Dates and money | Calendar days `dd/MM/yyyy` in the gym timezone; times `HH:mm`; instants ISO 8601 UTC; money whole VND. |

## Resources

| Area | Endpoints |
|---|---|
| Me and auth | `/api/auth/*` (Better Auth), `GET /me`, `PATCH /me/locale` |
| Platform | `/users`, `/roles` (clone), `/permissions` (tree), `/users/:id/overrides`, `/branches`, `/option-lists/:key/options`, `/parameters`, `/session-status-rules`, `/approval-rules`, `/approvals` (inbox, approve, reject), `/audit-events`, `/trash`, `/notifications`, `/files` (signed upload and download) |
| Employees | `/employees`, `/employees/:id/schedules` |
| Leads | `/leads` (create, list, kanban counts), `/leads/:id`, `/leads/:id/assign`, `/leads/:id/status`, `/leads/:id/steps/:stepId` (complete with result), `/leads/:id/appointments`, `/leads/:id/show`, `/leads/:id/convert`, `/leads/duplicates?phone=`, `/leads/:id/merge`, `/recare`, `/my-day`, `/consulting-scripts`, `/leads/:id/audit` |
| Customers | `/customers`, `/customers/:id` and its tabs (`/contracts`, `/receipts`, `/plans`, `/session-logs`, `/progress`, `/consulting-history`, `/emails`) |
| Services | `/services`, `/services/:id/tiers` (versions), `/services/:id/quick-packages`, `/promotions`, `/price-quote` (service + sessions → unit price, total, end date, name) |
| Contracts | `/customers/:id/contracts` (create pending), `/contracts`, `/contracts/:id` (`PATCH` only while pending), `/contracts/:id/check-ins`, `/contracts/:id/history`, `/contracts/:id/deactivate`, `/contracts/:id/reactivate` (returns the proposed extension; confirm with chosen days), `/contracts/:id/unapprove`, `DELETE /contracts/:id` |
| Change vouchers | `/contracts/:id/changes` (kind-specific bodies), `/changes/:id` |
| PT schedule | `/schedule?date=&branch=&pt=&customer=&view=day|week`, `/sessions` (book), `/sessions/:id`, `/sessions/:id/trained`, `/sessions/trained` (bulk), `/sessions/:id/cancel`, `/sessions/:id/no-show`, `DELETE /sessions/:id` (wrong booking or check-in history deletion), `/sessions/burn` (Burn Show) |
| Classes | `/classes`, `/class-sessions?from=&to=`, `/class-sessions/:id/enrollments`, `/class-sessions/:id/attendance` |
| Workouts | `/catalog/equipment`, `/catalog/areas`, `/catalog/exercises`, `/catalog/stages`, `/plan-templates`, `/customers/:id/plans`, `/plans/:id`, `/sessions/:id/log`, `/escalations` (review) |
| Cash book | `/receipts`, `/expense-vouchers`, `/payouts` (from an allocation period), `/receipts/:id/date` (date edit permission), `/cashbook?from=&to=&branch=&method=` |
| Tasks | `/tasks` (mine, assigned by me, department), `/tasks/:id/accept`, `/tasks/:id/status`, `/tasks/:id/comments` |
| Email | `/email-templates`, `/customers/:id/emails` |
| Reports | `/reports/overview`, `/reports/consulting`, `/reports/leads`, `/reports/workouts-weekly`, `/reports/contracts`, `/reports/exception-prices`, `/reports/bookings`, `/reports/pt-revenue`, `/reports/cashbook`, `/reports/tasks` — each with `/export` |
| Import | `/imports` (upload, dry run on staging, cleanup list, apply) |

## Error contract

```json
{ "code": "CONTRACT_LOCKED", "message": "Approved contracts cannot be edited", "details": {} }
```

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Input fails validation, including "Khác" without a note |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Create without a key |
| `UNAUTHENTICATED` | 401 | No valid session, disabled account, or outside allowed hours |
| `FORBIDDEN` | 403 | Permission, branch, or data scope denies the action |
| `NOT_FOUND` | 404 | Missing, deleted, or out of scope |
| `INVALID_STATUS_TRANSITION` | 409 | Action not allowed from the current status |
| `CONTRACT_NOT_APPROVED` | 409 | Booking or check-in on a pending contract |
| `CONTRACT_LOCKED` | 409 | Editing an approved contract (D-022) |
| `CONTRACT_FROZEN` | 409 | Booking, check-in, or Burn Show on a frozen contract |
| `CONTRACT_EXPIRED` | 409 | Booking on an expired contract |
| `CONTRACT_NO_REMAINING_SESSIONS` | 409 | No session left to book or consume |
| `CONTRACT_HAS_DEPENDENTS` | 409 | Deleting a contract with receipts, sessions, or change vouchers; `details` lists them |
| `SESSION_LOCKED` | 409 | Changing a session in *Đã tập* (D-026) |
| `TRAINER_OVERLAP` | 409 | PT already has a session at that time |
| `CUSTOMER_OVERLAP` | 409 | Customer already has a session at that time |
| `OUTSIDE_WORKING_SCHEDULE` | 409 | Cell not bookable for that PT |
| `CLASS_FULL` | 409 | Enrollment beyond capacity |
| `APPROVAL_SELF_DECISION` | 409 | Approving one's own submission |
| `DUPLICATE_PHONE` | 409 | Phone already used; `details` has the existing person for merging |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key, different content |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Body not JSON |
| `PAYMENT_EXCEEDS_CONTRACT_VALUE` | 422 | Receipt above the remaining value (OQ-003 interim) |
| `BOOKING_OUTSIDE_CONTRACT_PERIOD` | 422 | Session day outside the contract dates (OQ-001) |
| `INTERNAL_ERROR` | 500 | Unexpected; details only in server logs |

Codes from Phases 0–4 that map to these: `BOOKING_TRAINER_OVERLAP` → `TRAINER_OVERLAP`, `CONTRACT_NOT_ACTIVE` → `CONTRACT_NOT_APPROVED` / `CONTRACT_EXPIRED` / `CONTRACT_FROZEN`, `CONTRACT_NOT_EDITABLE` → `CONTRACT_LOCKED`, `PAYMENT_CONTRACT_CANCELLED` (kept), `CONTRACT_HAS_CHECKED_IN_BOOKING` (retired with check-in, D-026), `EMAIL_ALREADY_USED`, `CANNOT_CHANGE_OWN_ACCESS` (kept).

## Current state

Since M1 slice 1 the API is the NestJS app; its OpenAPI document is `apps/api/openapi.json` (interactive at `/api/docs` outside production). It still has the Phases 0–4 resources, under their old paths:

| Area | Endpoints |
|---|---|
| Me | `GET /me` (user, role, `trainerId`, effective `permissions`, `dataScopes`, `allBranches`, usable `branches`, `maskedFields`), `PATCH /me/locale` |
| Customers | `/customers` (`?search=&page=&pageSize=`), `/customers/:id`, `/customers/:id/contracts` (list; create with `Idempotency-Key`) |
| Contracts | `/contracts` (`?q=&customerId=`), `/contracts/:id`, `/contracts/:id/activate`, `/contracts/:id/cancel`, `/contracts/:id/payments` (list; record with `Idempotency-Key`) |
| Trainers | `/trainers` (`?activeOnly=`), `/trainers/:id`, `/trainers/logins` |
| Bookings | `/bookings` (filters), `/bookings/:id` (get, reschedule), `/bookings/:id/cancel`, `/no-show`, `/check-in`, `/complete`; `/schedule?date=&trainerId=` (one gym day) |
| Money | `/payments` (filters), `/payments/collected?from=&to=`, `/payments/:id` (`DELETE`), `/debts`, `/cash-transactions` (list; record with `Idempotency-Key`), `/cash-transactions/summary?from=&to=`, `/cash-transactions/:id` (`DELETE`) |
| History | `/trash` (`?entityType=&from=&to=`), `/audit-events` (`?entityType=&entityId=&actorUserId=&from=&to=`); both read-only |
| Users | `/users` (list, create with role and branches), `/users/:id` (detail), `/users/:id/role`, `/users/:id/status`, `/users/:id/password`, `/users/:id/branches`, `/users/:id/overrides`, `/users/:id/access-hours` (`PUT`), `/users/:id/logins` (login history, paged) |
| Roles | `/roles` (list, create), `/roles/:id` (get, `PUT` permissions, data scopes, hidden fields), `/roles/:id/clone` |
| Branches | `/branches` (list, create), `/branches/:id` (`PATCH` name, address, active) |
| Configuration | `/option-lists/:key/options` (list, `?includeInactive=`; create), `/option-lists/:key/options/:id` (`PATCH` labels, active), `/option-lists/:key/order` (`PUT`), `/option-lists/:key/other-notes` ("Khác" notes, most used first); `/parameters` (`GET`, `PUT`) |

Calendar days in queries and bodies are `dd/MM/yyyy`; responses carry instants and calendar days as ISO 8601 (calendar days at UTC midnight). Lists answer `{ items, total, page, pageSize }` without `totals` yet. Since M1 slice 2 every operation states its permission keys in `x-permission` (T-054); customers, contracts, trainers, sessions, receipts, and cash entries carry a `branch`, creates take an optional `branchId` (A-031), and masked fields come back as `null` with their names in `maskedFields`. Since M1 slice 3 payments take `methodId` and `methodNote`, cash entries `categoryId` and `categoryNote`, and voids `reasonId` and `reasonNote`; responses show the chosen option with its labels and note. Since M1 slice 4 payments and cash entries have no status: deleted ones are only in the trash (T-056). "Khác" without a note is `VALIDATION_FAILED` with `otherNeedsNote` on the note field. These resources are replaced by the ones above as their milestones land.
