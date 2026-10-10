# 13 — Test Strategy

## Test pyramid

| Level | Tool | Focus |
|---|---|---|
| Unit | Vitest | Pure rules: price tier lookup and totals, end-date and extension calculations, status-rule application, derived figures (sessions left, paid, debt, PT allocation), permission evaluation (role + overrides + scope + masks), option validation ("Khác" note), timers, `vi`/`en` message keys identical |
| Integration | Vitest against real PostgreSQL | API services with transactions: approvals (no self-approval, no effect while pending), locked contracts, deletion order and trash, consumption under concurrency, overlaps (trainer and customer), idempotency, receipts and debt, payouts without double pay, audit before/after, data scope and masking |
| API contract | Vitest + generated OpenAPI | Every endpoint declares a permission; responses match the schema; masked fields absent |
| E2E | Playwright against web + API | Critical journeys and acceptance criteria (doc 14), desktop and phone viewports |
| Security | Playwright + Vitest | OWASP Top 10 suite (`24_SECURITY_TESTING.md`) for every endpoint |

Integration tests run against a real PostgreSQL database because row locks, exclusion constraints, and unique indexes are PostgreSQL behavior.

## E2E structure

- Specs import `test` and `expect` only from the composition root `e2e/fixtures.ts`; page objects in `e2e/pages/` hold every locator, scoped to the region that owns it.
- One saved session per seeded role; the role and permission seed mirrors `09_RBAC.md`.
- Every test tags the data it creates; fixture teardown removes it, even on failure. Teardown deletes test data directly in the E2E database, outside the trash rules.
- Labels come from the message catalog with the locale pinned to `vi`.
- An open dialog hides the page from the accessibility tree; close it with its own button before asserting on the page.
- E2E runs against production builds of web and API.

## Critical scenarios

| ID | Scenario | Criterion |
|---|---|---|
| E2E-101 | Lead from the quick form → assigned round-robin → checklist steps → appointment → Show → converted with the same ID | AC-06, AC-09 |
| E2E-102 | Duplicate phone → warning → merge, one record | BR-202 |
| E2E-103 | "Khác" without note refused; option deactivated stays on old record (`e2e/configuration.spec.ts`, `e2e/finance.spec.ts`) | AC-03, AC-04 |
| E2E-104 | Contract with any session count → tier price, end date, name; exception price stays pending; booking refused until approved | AC-10, AC-11 |
| E2E-105 | Approved contract cannot be edited by admin | AC-11 |
| E2E-106 | Delete contract with receipts → blocked with list → delete receipts → delete contract → totals drop; both in trash (receipts part: `e2e/history.spec.ts`, M1 slice 4; contracts in M4) | AC-12, AC-13 |
| E2E-107 | Freeze → booking refused → reactivate → proposed extension → confirm once | AC-14 |
| E2E-108 | Đã tập and no-show consume 1 and credit PT; Hủy lịch and delete do not; colors | AC-15 |
| E2E-109 | Đã tập locked; delete from history → refund 1, credit −1, email sent, adjustment in next period | AC-16, AC-17 |
| E2E-110 | Two receipts → paid and debt; cash book balance | AC-19 |
| E2E-111 | Session log on phone: plan and actual per row; cardio fields; escalation reaches manager and Master | AC-20, AC-21, AC-23 |
| E2E-112 | Role without a module: menu hidden and direct URL refused; masked phone absent from screen and export | AC-01 |
| E2E-113 | Submitter cannot approve own request; approval matrix change takes effect immediately (`e2e/approvals.spec.ts`) | AC-05 |

## Concurrency scenarios (integration)

| ID | Scenario |
|---|---|
| INT-001 | 10 parallel "Đã tập" on one session consume once and audit once. |
| INT-002 | Two sessions racing for a contract's last session: exactly one consumes. |
| INT-003 | Two overlapping bookings for one PT at once: one succeeds. |
| INT-004 | The same receipt submitted twice with one key records once. |
| INT-005 | The same key with another amount is refused. |
| INT-006 | A disabled account, or a sign-in outside allowed hours, loses access on the next request. |
| INT-007 | Exclusion constraints for PT and customer overlap exist in the migrated database. |
| INT-008 | Contract expiry at the timezone boundary; no expiry while frozen. |
| INT-009 | Two overlapping bookings for one customer with two PTs at once: one succeeds. |
| INT-010 | Approve and delete of the same pending record at once: one wins, the other gets a clear error. |
| INT-011 | Two payouts for the same period and PT at once: no session paid twice. |
| INT-012 | Reactivating a frozen contract twice at once extends the end date once. |

## Reused from Phases 0–4

The Phases 0–4 suites (unit, integration, E2E, security) remain green until milestone M1 restructures the code; scenarios for superseded rules (check-in step, no-show without consumption) are rewritten in M5 together with the code (`25_BRIEF_V2_GAP_ANALYSIS.md`).

## Quality gates

Before merge: lint, type-check, unit, integration (including INT-001 to INT-012 as their features land), API contract tests. Before a milestone is delivered to staging: the full E2E and security suites, migration on a copy of production data, and the milestone's acceptance criteria.
