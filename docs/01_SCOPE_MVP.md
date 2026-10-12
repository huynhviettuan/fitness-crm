# 01 — Phase 1 Scope

Phase 1 delivers 12 modules (brief §1, D-013), in the milestones of `16_IMPLEMENTATION_PLAN.md`.

| Module | Main content | Brief | Requirements |
|---|---|---|---|
| Platform and permissions | Users, roles, permission tree, branches, approvals, option lists, parameters, audit log, trash, notifications, employees | §2, §8.4, §8.5 | FR-PLT, FR-EMP, FR-TRASH |
| Leads and consulting | Lead intake, automatic assignment, timed consulting checklist, reminders, audit, re-care, script library | §3, §4.1 | FR-LEAD |
| Customers | One profile from lead to member | §4.2 | FR-CUS |
| Services and price tiers | Services, tiers by session range, promotions and vouchers | §5.1 | FR-SVC |
| Contracts | Create, approve, lock, freeze, delete; change vouchers | §5.2–§5.6 | FR-CON, FR-CHG |
| PT schedule | Booking, check-in ("Đã tập"), session statuses, consumption, PT credit, Burn Show | §6.1–§6.3, §6.5 | FR-PT |
| Class schedule | Group classes, enrollment, attendance | §6.4 | FR-CLS |
| Workout plans | Catalogs, templates, customer plans, session logs, Flag, Action, escalation | §7 | FR-WKO |
| Cash book | Receipts, expense vouchers, debt, PT payouts | §8.1 | FR-CASH |
| Tasks | Assigning and tracking work within and between departments | §8.2 | FR-TASK |
| Customer email | Automatic emails when sessions change and on other events | §8.3 | FR-MAIL |
| Dashboards and reports | Consulting, workouts, contracts, sessions, money, tasks | §9 | FR-RPT, doc 10 |

## Cross-cutting requirements

- Several branches from the start (D-014).
- Every value configurable by admin; drop-downs with "Khác" (D-015, D-016).
- Approval matrix (D-018).
- Shared list screen: filters on the left, search, table with paging and totals row, Add, Export Excel (brief §1).
- Web app usable on phones; Vietnamese UI, ready for English (D-043).
- Sensitive personal data protected (D-042).
- Data imported from GymMaster and the consulting Excel (D-039).
- Lead channel APIs enabled gradually after manual entry (D-044).

## Out of phase 1

Pro Shop, lockers, towels, loyalty contracts and points, day passes, attaching fingerprint machines (the scan API and pairing are built in M5, D-069), member mobile app, Zalo OA, tax accounting and e-invoices, and other ERP modules (retail, inventory, HR and payroll). Also not built: GymMaster's "edit approved contract", "type sessions used", "deposit payout", and "free package" (D-022). See `19_FUTURE_ROADMAP.md`.
