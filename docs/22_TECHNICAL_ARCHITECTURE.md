# 22 — Technical Architecture

Decisions T-041 to T-053; technology, hosting, and costs in `26_TECH_PROPOSAL.md`.

## 1. Shape

```text
Browser (desktop, phone)
   │
   ▼
apps/web — Next.js on Vercel (UI only)
   │  Server Components and Server Actions: typed client generated from OpenAPI, the user's cookie
   │  browser requests to /api/*: forwarded with X-Forwarded-For (T-053)
   ▼
apps/api — NestJS on Railway/Render (Singapore)
   ├── HTTP: controllers → services → repositories → Prisma
   └── worker: pg-boss jobs (timers, reminders, email outbox, notifications, backups)
   │
   ▼
PostgreSQL          Cloudflare R2 (files)          Email provider
```

Future clients (member app, check-in devices, ERP modules) call the same `/api/v1` (T-043). No other backend, Redis, or broker (AGENTS.md §2).

## 2. Layers

| Layer | Where | Responsibilities | Must not |
|---|---|---|---|
| Presentation | `apps/web` | Screens, forms, client validation with shared Zod schemas, hide what the user lacks permission for | Hold business rules, touch the database, compute authoritative figures |
| Controller | `apps/api/src/**/*.controller.ts` | Route, permission key, reading path, query, and body, encoding the result with its response schema from `packages/shared`, OpenAPI | Contain business logic |
| Service | `*.service.ts` | Rules, state transitions, approvals, transactions and locks, idempotency, audit, trash, outbox events | Build SQL directly |
| Repository | `*.repository.ts` | Prisma queries, row locks with `$queryRaw`, scope filters | Decide business outcomes |
| Platform | `apps/api/src/platform/*` | Auth, permission guard and scope, branches, approvals, audit, trash, configuration, notifications, files, jobs | Know module specifics |
| Database | PostgreSQL | Source of truth; constraints that must hold under concurrency (exclusions, unique keys, checks) | — |

## 3. Request lifecycle

1. Authentication: session cookie or token → user, account status, and login window (T-017, D-017).
2. Authorization guard: permission key of the endpoint; effective permissions = role + overrides (T-046).
3. Scope: branch access and data scope become filters passed to repositories; out-of-scope records are `404`.
4. Validation with Zod from `packages/shared`, inside the service (`parseInput`), so errors keep the documented format.
5. Service: if the action is under the approval matrix, store it as pending and create an approval request (D-018); otherwise apply it in a transaction with audit (T-048).
6. Response: the controller encodes the result with its schema (`encode`), which drops any field the schema does not list; masking (T-046) will hook in here, and exports use the same path.

Before all of this, middleware rejects state changes without the app's Origin or with a non-JSON body (T-033), and an error filter turns every exception into the documented error body (405 for a known path with another method).

## 4. Configuration

Option lists, parameters, status rules and colors, approval matrix, code prefixes, email templates, service tiers, and timers are tables (T-049), read through a configuration service with a short per-request cache. Business code never contains these values; seeds load the brief's initial values.

## 5. Approvals

A pending record is stored with `approval_status = PENDING` and does not count anywhere (sessions, money, reports, bookings) until approved. `approval_requests` holds the payload of edits to existing records. Deciding locks the request row, rejects the submitter, applies the change and audit in the same transaction, and closes the approver's task. Overdue requests are a scheduled job.

## 6. Soft delete and trash

A Prisma client extension adds `deleted_at IS NULL` to every query on business models and turns `delete` into a refused operation; deletion goes through the trash service, which checks dependents (e.g. receipts before contracts), sets the soft-delete columns, writes the snapshot to `trash_entries`, and audits — in one transaction (T-047, D-035).

## 7. Transactions, concurrency, idempotency

Sessions and money must be correct when requests arrive at the same time.

### Setting a session status (T-013, T-050)

```text
Request: set session S to status X (e.g. Đã tập, no-show)
  -> authenticate; permission for X; validate
  -> read S.contract_id (no lock)
  -> BEGIN
       SELECT contract ... FOR UPDATE          -- serializes every change on this contract
       SELECT session S ... FOR UPDATE
       if S.status = X: COMMIT; return S       -- idempotent repeat, nothing consumed again
       if S is locked (Đã tập): reject SESSION_LOCKED
       if X not allowed from S.status: reject INVALID_STATUS_TRANSITION
       if contract frozen / not approved: reject
       rule = status rule of X (consumes, credits_pt, holds_slot)
       if rule.consumes and sessions_left(contract) <= 0: reject CONTRACT_NO_REMAINING_SESSIONS
       UPDATE session SET status = X, consumes, credits_pt, holds_slot (snapshot)
         WHERE id = S AND status = old_status    -- exactly one row
       insert audit event; enqueue customer email (outbox) if the session count changed
     COMMIT
```

- `sessions_left` is derived inside the lock: bought + bonus + change-voucher adjustments − opening used − consuming sessions and attendance (T-050).
- Lock order is always contract → session (or voucher). Every operation that changes a contract's sessions or money takes the contract lock first: bookings, status changes, deleting from check-in history, Burn Show, attendance, receipts, expense refunds, change vouchers, freeze and reactivation (T-036, T-040).

### Other critical writes

| Operation | Safety mechanism |
|---|---|
| Book a session | Contract lock; pre-checks; exclusion constraints per PT and per customer map SQLSTATE `23P01` to `TRAINER_OVERLAP` / `CUSTOMER_OVERLAP` (T-014) |
| Create contract, receipt, expense voucher, change voucher | Idempotency key with unique index; replay re-checked under the contract lock (T-015, T-040) |
| Approve / reject | Lock the approval request; conditional status update; submitter ≠ approver |
| Reactivate a frozen contract | Lock contract and the open freeze; extension applied once (D-023) |
| PT payout | Unique payout line per session, so concurrent payouts cannot pay a session twice (D-032) |
| Codes | Sequences per prefix, never reused (D-038) |

Every one of these writes its audit event in the same transaction (T-048).

### Prisma notes

- Row locks via `$queryRaw` inside interactive `$transaction` with explicit timeouts; no network calls inside.
- Exclusion violations arrive as `P2039` with SQLSTATE `23P01` in `meta.driverAdapterError.cause.code` (`isExclusionViolation`).

## 8. Jobs and outbox (T-045)

pg-boss queues in PostgreSQL, processed by the worker: consulting step timers and reminders, re-care dates, approval and task overdue checks, freeze reminders (> 10 days), email outbox sending and retries, notification fan-out, nightly backup copy. Jobs are idempotent and keyed by the entity and step, so a retry never duplicates a reminder or an email.

Customer email (A-106): a feature calls `queueEmail(tx, …)` in its own transaction, with a `dedupeKey` naming the cause. The `mail` queue (every minute) claims due rows with `FOR UPDATE SKIP LOCKED`, moves their next attempt ahead as a lease, sends outside the transaction with the row id as the provider's idempotency key, and records the result; a worker that dies leaves the lease to expire and the email is sent again under the same key. Retries wait 1, 5, and 30 minutes.

## 9. Derived values

Never trust client values for sessions left, paid, debt, prices, payment status, PT credits, or permissions. They are computed by the API from records (T-050, D-034, D-032). Cached figures are allowed later only with a designed invalidation.

## 10. Extraction and growth

Modules map one-to-one to NestJS modules with their own tables, so ERP modules can be added as new modules, and a module can later move to its own service behind the same API contract if load requires it.
