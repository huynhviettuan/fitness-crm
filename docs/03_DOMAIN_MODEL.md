# 03 — Domain Model

The main axis is **Person (lead / customer) → Contract → Session → Receipt / Expense voucher** (brief §10). Every business record has a branch, its creator, and created/updated times. Fields and constraints are in `04_DATA_MODEL_ERD.md`.

| Entity | Meaning | Key rules |
|---|---|---|
| Branch | A Demo Gym location | Parent of most records (D-014). |
| User account, Role, Permission | Sign-in, configurable role, permission tree with actions, per-user overrides, branch access, login hours, login history | D-017; every account belongs to an employee. |
| Employee | Staff member: department, title, branch, working status; PTs have working schedules | Defines bookable cells (D-030). |
| Option list, Parameter, Status rule | Admin-managed values: drop-down options, timers and thresholds, session status rules and colors | D-015, D-016, T-049. |
| Approval request, Approval matrix | A submitted change waiting for approval; which actions need approval by whom | D-018. |
| Person (Lead / Customer) | One profile from first contact; a lead becomes a customer at Show with the same ID | D-019; duplicate phones merge. |
| Consulting step | One checklist step of a lead: type, deadline, completion, result, on time or late | D-020. |
| Lead history, Appointment | Status changes with reasons; visit date and confirmations, Show / No show | D-020. |
| Consulting audit | Automatic score, manager grade and comments, AI suggestions | D-045. |
| Consulting script | Situation with Vietnamese and English answers | Shared library. |
| Service, Price tier | What is sold; price per session by session range, validity, versions | D-021. |
| Promotion, Voucher | Percent or amount off, with dates | Applies to tier price. |
| Contract | Purchase of a service by a customer: sessions bought and bonus, tier and approved unit price, exception flag, value, VAT, dates, previous contract, PT and Sale splits, signature, status, approver | D-022; locked after approval. |
| Freeze | One deactivation: from, to, reasons, days added | D-023. |
| Change voucher | Renewal, upgrade, hold, transfer, branch transfer, conversion, cancellation | D-024. |
| Receipt, Expense voucher | Money in and out: number, amount, date, method, creator, expense type, payout period | D-034. |
| Booking / Session | A PT appointment and what happened: customer, contract, PT, times, status, confirmation method, added-by-hand flag, consume and credit flags | D-025–D-028, T-050. |
| PT payroll adjustment | A deleted session in a paid period, applied to the next period | D-027. |
| Class, Class session, Attendance | Group classes, their occurrences, and who attended | D-031. |
| Equipment, Area, Exercise, Stage, Plan template | Workout catalogs | D-033. |
| Customer plan, Plan line | A customer's plan by week, session, stage, exercise, set, targets | D-033. |
| Session log, Set result | Pre/in/post-session data, actuals per set, Flag, Action | D-033. |
| Task, Comment | Work assigned to a person or department, linked to a lead, customer, contract, or session | D-037. |
| Email template, Email sent | Event templates in Vietnamese and English; each email with status | D-036. |
| Notification | In-app message to a user | — |
| Trash entry, Audit event | Deleted record with reason; who did what, before and after | D-035, T-048. |

Derived values are never stored as editable numbers:

- sessions used and left (T-050);
- paid amount, debt, and payment status (D-034);
- contract status *Expired* (derived from the end date, suspended while frozen);
- customer status (D-040);
- PT credited sessions and allocation (D-032).
