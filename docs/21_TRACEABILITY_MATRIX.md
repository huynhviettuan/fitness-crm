# 21 — Traceability Matrix

| Business Rule / Requirement | API | UI | Test |
|---|---|---|---|
| BR-001 Unique customer | `POST /customers` | Customer Create | `customers.int.test.ts` (sequence codes, concurrent creates) + E2E-001 part 1 |
| FR-CUS-002 Customer search | `GET /customers?search=` | Customer list, Ctrl+K search | `customers.int.test.ts` (accent-insensitive) + E2E-001 part 1 |
| FR-ADM-001 User management | Server Actions (no public API) | Administration › Users | `users.int.test.ts` + `rbac.spec.ts` |
| BR-002 Multiple contracts | `POST /customers/:id/contracts` | Customer Detail › Contracts tab | E2E-001 part 2 (`contracts.spec.ts`), `contracts.int.test.ts` |
| BR-017/BR-018, T-015, T-018 Contract lifecycle, opening balances, duplicate submission, expiry | contract endpoints | Contract Detail | `contracts.int.test.ts` (incl. INT-008), `contract.test.ts`, `e2e/security/contracts.spec.ts` |
| BR-004 Booking no consume | `POST /bookings` | PT Calendar, Contract Detail | E2E-002 (`bookings.spec.ts`), `bookings.int.test.ts` |
| BR-005 Check-in no consume | `POST /bookings/:id/check-in` | Booking sheet | E2E-003, `sessions.int.test.ts` |
| BR-006 Completion consumes one | `POST /bookings/:id/complete` | Booking sheet | E2E-004, `sessions.int.test.ts` |
| BR-007 Completion idempotent | same | same | E2E-005 + INT-001 (`sessions.int.test.ts`, and over HTTP in `e2e/security/bookings.spec.ts`) |
| BR-008 Cancel/no-show no consume | cancel/no-show endpoints | Booking sheet, Sessions | `bookings.spec.ts`, `bookings.int.test.ts` |
| BR-009 No negative remaining | complete endpoint | Completion action | E2E-006 (booking refused, OQ-008 interim) + INT-002 + D-011 test (`sessions.int.test.ts`) |
| BR-010 Trainer overlap | booking create/update | Calendar | E2E-007 + INT-003 + INT-007 (`bookings.int.test.ts`) |
| BR-003, BR-011, BR-012; OQ-001, OQ-008, OQ-010 interim | `POST /bookings`, `PATCH /bookings/:id` | Booking dialog | `bookings.int.test.ts`, `booking.test.ts`, `e2e/security/bookings.spec.ts` |
| BR-017, D-010 Contract cancel cascade | `POST /contracts/:id/cancel` | Contract Detail cancel dialog | `contracts.int.test.ts` (cascade, refusal, race with check-in), `bookings.spec.ts` |
| A-007, A-010 Trainer scope and login link | trainer and booking endpoints | Trainers, PT Calendar | `trainers.int.test.ts`, `bookings.int.test.ts`, `sessions.int.test.ts`, `bookings.spec.ts` (phone width) |
| BR-013 Debt derived | payment endpoints | Contract Detail, Finance › Debt | E2E-008 (`finance.spec.ts`), `payments.int.test.ts` |
| BR-014, A-008 Payment validation and void | `POST /contracts/:id/payments`, `POST /payments/:id/void` | Record payment dialog, void dialog | `payments.int.test.ts`, `finance.test.ts`, `finance.spec.ts`, `e2e/security/finance.spec.ts` |
| OQ-003 interim Overpayment refused | `POST /contracts/:id/payments` | Record payment dialog | `payments.int.test.ts` (incl. race), `finance.spec.ts` |
| FR-CASH-001, FR-CASH-002, A-009, OQ-007 interim | `/cash-transactions` | Finance › Income / Expense | `cash.int.test.ts`, `finance.spec.ts` |
| BR-016 Authorization | all protected endpoints | role-specific UI | E2E-009 (`rbac.spec.ts`; trainer cannot void payments in `e2e/security/finance.spec.ts`) |
| T-015 Duplicate-submission safety | contract/payment/cash create with `Idempotency-Key` | Contract / payment / cash forms | INT-004 + INT-005 (`payments.int.test.ts`, over HTTP in `e2e/security/finance.spec.ts`), `cash.int.test.ts`, `contracts.int.test.ts` |
| T-017 Account disablement | all protected endpoints | Administration | INT-006 (`users.int.test.ts`) |
| T-018 Derived contract expiry | contract endpoints | Contract Detail / Dashboard | INT-008 |
| OWASP Top 10:2025 (T-032 to T-035) | all routes, actions, and pages | all screens | `e2e/security/*`, `security.int.test.ts`, `server-actions.test.ts`, `npm run security:audit` (mapping in doc 24) |
| FR-DASH-001 | `/dashboard/summary` | Dashboard | API aggregation + UI smoke |
| FR-AUD-001 | internal audit writer | Admin audit view | integration test |

Update this table whenever new requirements are added.
