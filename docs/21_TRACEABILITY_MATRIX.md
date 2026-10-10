# 21 — Traceability Matrix

From the brief to decisions, requirements, API, screens, and tests. Test IDs are planned in `13_TEST_STRATEGY.md`; acceptance criteria are in `14_ACCEPTANCE_CRITERIA.md`. Update this table as each milestone lands.

| Brief | Decisions / rules | Requirements | API | Screen (doc 08) | Tests | Milestone |
|---|---|---|---|---|---|---|
| §1 Fixed flow, configurable values, drop-downs | D-015, D-016, BR-102 | FR-PLT-005, FR-PLT-006 | `/option-lists`, `/parameters`, `/session-status-rules` | 22 | AC-02–AC-04, E2E-103 | M1 |
| §2 Users, roles, permissions | D-017, BR-101, BR-107 | FR-PLT-001–FR-PLT-004 | `/users`, `/roles`, `/permissions`, `/me` | 22 | AC-01, E2E-112, INT-006, security suite | M1 |
| §2 Approvals | D-018, BR-103 | FR-PLT-007 | `/approvals`, `/approval-rules` | 11 | AC-05, E2E-113, INT-010 | M1 |
| §2 Audit log | T-048, BR-106 | FR-PLT-008 | `/audit-events` | 22 | integration (before/after) | M1 |
| §3 One person, journey | D-019, BR-201, BR-202 | FR-LEAD-008, FR-LEAD-009 | `/leads/:id/convert`, `/leads/:id/merge` | 4 | AC-09, E2E-101, E2E-102 | M2 |
| §4.1 Lead intake and assignment | D-020, D-044, BR-203 | FR-LEAD-001–FR-LEAD-003 | `/leads`, `/leads/:id/assign` | 3 | AC-06 | M2 |
| §4.1 Consulting checklist, re-care | D-020, BR-204, BR-205 | FR-LEAD-004–FR-LEAD-007 | `/leads/:id/steps`, `/my-day`, `/recare` | 4, 5, 6 | AC-07 | M2 |
| §4.1 Scripts, audit | D-045 | FR-LEAD-010–FR-LEAD-012 | `/consulting-scripts`, `/leads/:id/audit` | 4, 7 | AC-08 | M2, M3, M11 |
| §4.2 Customers | D-040, BR-206, BR-207 | FR-CUS-001–FR-CUS-005 | `/customers` | 8 | E2E-101 | M2, M4 |
| §5.1 Services, tiers, promotions | D-021, BR-301–BR-303 | FR-SVC-001–FR-SVC-004 | `/services`, `/promotions`, `/price-quote` | 9, 22 | AC-10, E2E-104 | M4 |
| §5.2–§5.4 Contract approval, lock, delete | D-022, BR-304–BR-306 | FR-CON-001–FR-CON-007 | `/contracts` | 9, 10, 11 | AC-10–AC-13, E2E-104–E2E-106 | M4 |
| §5.5 Deactivation | D-023, BR-307 | FR-CON-008 | `/contracts/:id/deactivate`, `/reactivate` | 10 | AC-14, E2E-107, INT-012 | M4 |
| §5.6 Change vouchers | D-024 | FR-CHG-001, FR-CHG-002 | `/contracts/:id/changes` | 12 | integration per kind | M8 |
| §6.1 PT grid and booking | D-030, BR-402, BR-403 | FR-PT-001, FR-PT-002 | `/schedule`, `/sessions` | 13 | AC-15, AC-23, INT-003, INT-007, INT-009 | M5 |
| §6.2 Session statuses | D-025, D-026, D-029, BR-404, BR-405, BR-409, T-050 | FR-PT-003, FR-PT-004 | `/sessions/:id/trained`, `/cancel`, `/no-show` | 13 | AC-15, E2E-108, INT-001, INT-002 | M5 |
| §6.3 Delete from history, Burn Show | D-026–D-028, BR-406–BR-408 | FR-PT-005, FR-PT-006 | `DELETE /sessions/:id`, `/sessions/burn` | 14 | AC-16, E2E-109 | M5 |
| §6.4 Classes | D-031, BR-411 | FR-CLS-001–FR-CLS-004 | `/classes`, `/class-sessions` | 15 | integration | M5 |
| §6.5 PT revenue allocation | D-032, BR-607, BR-608 | FR-PT-007, FR-CASH-003 | `/reports/pt-revenue`, `/payouts` | 19, 21 | AC-18, INT-011 | M5 |
| §7 Workout plans and logs | D-033, BR-501–BR-504 | FR-WKO-001–FR-WKO-005 | `/catalog/*`, `/plans`, `/sessions/:id/log`, `/escalations` | 16, 17, 18 | AC-20, AC-21, AC-23, E2E-111 | M7 |
| §8.1 Cash book | D-034, BR-601–BR-606, BR-609 | FR-CASH-001–FR-CASH-005 | `/receipts`, `/expense-vouchers`, `/cashbook` | 19 | AC-19, E2E-110, INT-004, INT-005 | M4 |
| §8.2 Tasks | D-037, BR-702 | FR-TASK-001–FR-TASK-006 | `/tasks` | 20 | integration, E2E | M1 |
| §8.3 Customer email | D-036, BR-701 | FR-MAIL-001–FR-MAIL-003 | `/email-templates`, `/customers/:id/emails` | 8, 22 | AC-17 | M6 |
| §8.4 Employees | brief §8.4 | FR-EMP-001, FR-EMP-002 | `/employees` | 22 | integration | M1 |
| §8.5 Trash | D-035, BR-104 | FR-TRASH-001, FR-TRASH-002 | `/trash` | 22 | AC-13, E2E-106 | M1 |
| §9 Reports | D-041 | FR-RPT-001 | `/reports/*` | 2, 21 | report reconciliation tests | M3, M5, M7, M9 |
| §11 Security, personal data | D-042, D-043, doc 12 | — | all | all | security suite (doc 24) | all |
| §11 Migration | D-039, D-011 | FR-IMP-001 | `/imports` | 22 | AC-22 | M9 |
| §11 Channel APIs | D-044 | FR-LEAD-001 | channel webhooks | — | per channel | M10 |
