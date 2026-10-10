# 13 — Test Strategy

## Test pyramid

Unit and integration tests use Vitest (T-021).

### Unit tests
Focus on pure business rules:

- session consumption
- debt calculation
- trainer time overlap
- valid state transitions
- `vi.json` and `en.json` contain exactly the same message keys
- `formatMoney` / date formatting (VND, `dd/MM/yyyy`, 24-hour, gym timezone)

### API / integration tests
Focus on:

- authentication/authorization
- database transactions
- booking validation
- payment persistence
- completion idempotency
- concurrency and duplicate submission

Integration tests run against a real PostgreSQL database. Row locks, the trainer-overlap exclusion constraint, and unique constraints are PostgreSQL behavior; mocks or SQLite cannot verify them.

### E2E tests — Playwright
Focus on critical user journeys, not every UI detail.

Structure (`e2e/`):

- Specs import `test` and `expect` only from `e2e/fixtures.ts`, the composition root. They never import `@playwright/test` or construct page objects themselves.
- Page objects in `e2e/pages/` hold every locator, scoped to the region that owns it.
- `auth.setup.ts` signs in once per role through the API and saves the session to `e2e/.auth/`. Specs start signed in with `test.use(signedInAs("ROLE"))`; only the login spec uses the login form.
- The `testTag` fixture gives each test a unique marker for the names it creates. Fixture teardown deletes that data even when the test fails.
- The E2E database is reset and seeded with one account per role in `e2e/support/global-setup.ts`.
- Cache Components keeps recently visited pages mounted but hidden. Role-based locators ignore hidden elements, which is one more reason never to use page-global CSS lookups.
- An open dialog or sheet hides the rest of the page from the accessibility tree, so `getByRole("main")` finds nothing until it closes. Close it with its own Close or Cancel button (not Escape, which can reach a confirmation that is still closing) before asserting on the page.

Running the suites:

```text
npm run db:up             # PostgreSQL in Docker
npm test                  # unit
npm run test:integration  # integration, against TEST_DATABASE_URL
npm run test:e2e          # builds, then Playwright against E2E_DATABASE_URL on port 3100
npm run test:security     # builds, then only the OWASP security suite (e2e/security)
```

E2E tests run against a production build (`next start`). This matches the deployed app (CSP, rate limiting) and does not collide with a developer's own `next dev`, since Next.js allows only one dev server per folder.

### Security tests

The OWASP Top 10:2025 suite lives in `e2e/security/`, `tests/integration/security.int.test.ts`, and `src/lib/security/`. Its mapping, the findings it caught, and the dependency gate are described in `24_SECURITY_TESTING.md`.

Locator rules (`23_UI_DESIGN_SYSTEM.md` §11):

- Locate with `getByRole` / `getByLabel`, scoped to the owning region (dialog, table row, page section). Never use a page-global lookup.
- Use `data-testid` only where role and name are ambiguous, such as calendar booking blocks.
- Run with the locale pinned to `vi` and read labels from the message catalog, never from hard-coded text.

## Critical scenarios

### E2E-001 — Customer → Contract
1. Create customer.
2. Create a 24-session contract.
3. Verify customer detail shows the contract.

### E2E-001 part 2 — Contract (built in Phase 2)
1. Open a customer, add a 24-session contract from the Contracts tab.
2. Verify it is a draft with 24 remaining and the full value as debt; activate it.
3. Verify the customer's Contracts tab shows it as active.

E2E-002 to E2E-007 are built in Phase 3 (`e2e/bookings.spec.ts`).

### E2E-002 — Booking does not consume
1. Contract has 24 total, 0 completed.
2. Create booking.
3. Verify remaining is still 24.

### E2E-003 — Check-in does not consume
1. Check in booking.
2. Verify remaining is unchanged.

### E2E-004 — Complete consumes exactly one
1. Complete checked-in session.
2. Verify completed = 1 and remaining = 23.

### E2E-005 — Repeated completion is safe
1. Retry the complete action/request.
2. Verify remaining is still 23.

### E2E-006 — No remaining sessions
1. Use a contract with 0 remaining.
2. Attempt to complete another session.
3. Verify operation is rejected.

Under the OQ-008 interim, a contract with 0 remaining cannot even be booked, so the E2E test checks that the booking is refused. The completion race is INT-002.

### E2E-007 — Trainer overlap
1. Create PT booking 18:00–19:00.
2. Attempt second active booking for same PT 18:30–19:30.
3. Verify rejection.

### E2E-008 — Debt (built in Phase 4, `e2e/finance.spec.ts`)
1. Contract value = 12,000,000.
2. Add confirmed payment 5,000,000.
3. Add confirmed payment 3,000,000.
4. Verify paid = 8,000,000 and debt = 4,000,000.

### E2E-009 — RBAC
Verify trainer cannot void payments or manage users.

## Concurrency and duplicate-submission scenarios (integration)

Concurrent requests must truly overlap: send them in parallel over separate connections (e.g. through the HTTP API or separate database clients), not one after another.

INT-001 to INT-003 and INT-007 are in `tests/integration/sessions.int.test.ts` and `bookings.int.test.ts`; INT-001 and INT-003 also run over HTTP in `e2e/security/bookings.spec.ts`.

### INT-001 — Parallel completion of the same booking
1. Checked-in booking on a contract with 24 total, 0 completed.
2. Send 10 completion requests for that booking at the same time.
3. Verify all return the completed state, completed = 1, remaining = 23, and exactly one completion audit event exists.

### INT-002 — Last-session race
1. Contract with 1 remaining session and two checked-in bookings.
2. Complete both bookings at the same time.
3. Verify exactly one succeeds, the other returns `CONTRACT_NO_REMAINING_SESSIONS`, and remaining = 0.

### INT-003 — Concurrent trainer overlap
1. Send two overlapping booking creates for the same trainer at the same time.
2. Verify exactly one is created and the other returns `BOOKING_TRAINER_OVERLAP`.

INT-004 and INT-005 are in `tests/integration/payments.int.test.ts`, and run over HTTP in `e2e/security/finance.spec.ts`.

### INT-004 — Duplicate payment submission
1. Submit the same payment twice with the same idempotency key.
2. Verify one payment exists and paid amount counts it once.

### INT-005 — Idempotency key reuse
1. Submit a payment, then submit a different amount with the same key.
2. Verify the second request returns `IDEMPOTENCY_KEY_REUSED` and nothing new is recorded.

### INT-006 — Disabled user
1. Sign in as a user, then disable the account.
2. Verify the next request with the existing session is rejected.

### INT-007 — Overlap constraint exists
Verify the migrated database contains the trainer-overlap exclusion constraint, so it cannot silently disappear from a migration.

### INT-008 — Contract expiry at the timezone boundary
1. Active contract whose `end_date` is today in the gym timezone.
2. Verify it is not expired at 23:59 gym time and is expired at 00:00 the next day, without any job running.

## Quality gates

Before merge:

- lint
- type-check
- unit tests
- API/integration tests against PostgreSQL, including INT-001 to INT-008

Before release:

- migration validation
- critical Playwright suite
- backup/restore readiness
- smoke test in production-like environment
