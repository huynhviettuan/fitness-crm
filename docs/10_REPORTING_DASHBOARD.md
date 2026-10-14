# 10 — Dashboards & Reports

From brief §9 (D-041). Every report filters by **branch, period, and staff**, exports to **Excel**, and is its own permission (D-017). Data scope and field masks apply to reports and exports.

| Report | Content | Milestone |
|---|---|---|
| Overview dashboard | New leads; conversion rate; members training; active PTs; contracts ending soon (expiring within 14 days or 3 sessions or fewer left, A-023, A-025); PT sessions per hour of the day; revenue by month and year | M9 (first version built M5.6: A-172) |
| Consulting dashboard | Per consultant and team: leads received; funnel Lead → Consulted → Appointment booked → Show → Contracted; show rate; on-time step compliance; time to first response; re-care results; audit score | M3 |
| Lead analysis | By channel, source, Organic/Paid, need group, nationality group, refusal reason; "Khác" entries per list | M3 |
| Weekly workout dashboard | Across all customers: % of each Flag and each Action over all sets logged; customers with at least one non-Normal Flag; comparison with last week; open escalations; drill down to customers and sessions | M7 |
| Contract report | Revenue, debt, new and renewed contracts, expiring or running out; grouped by service and session-tier band | M4 |
| Exception-price report | Share of contracts with exception prices and total difference vs tier price, by creator and approver | M4 |
| Booking report | Customer, phone (masked if hidden), check-in time, check-out time, status, staff, created date; filters by booking type and status | M5 (built M5.6: A-171) |
| PT revenue allocation | Columns below; totals per PT; Excel in GymMaster's column order | M5 (built M5.6: A-166 to A-170) |
| Cash book | Cash book per period (opening, in, out, closing) per method and branch; income and expense; member debt | M4 (built M4.7: A-138 to A-142) |
| Tasks | Assigned, done on time, late, per person and department | M1 |

## PT revenue allocation (brief §6.5, D-032)

One row per PT–contract pair in the period, matching GymMaster's "employee_pt_training" export:

| Column | Calculation |
|---|---|
| Employee code and name; member code and name; phone; branch | From profiles |
| Contract code, service, contract value | From the contract |
| Allocation value | Part of the contract value divided across sessions (A-026: value after discounts, excluding VAT) |
| Sessions | Sessions bought + bonus sessions |
| Allocation per session | Allocation value ÷ sessions |
| Credited sessions ("Show dạy") | Sessions of that PT on that contract in the period with `credits_pt` (Đã tập, no-show, Burn Show) |
| Commission rate, timesheet rate | Configuration (100% initially; level per OQ-022) |
| PT allocation | Credited × per-session allocation × commission rate × timesheet rate |
| Total credited | All credited sessions of the PT in the period |
| Adjustments | Negative lines from deleted sessions of paid periods (D-027) |
| Trial to contract, note | Trial session that led to the contract; note |

The report is the basis of PT payout vouchers (D-032, `06_FUNCTIONAL_REQUIREMENTS.md` FR-CASH-003).

## Data consistency

- Dashboards and reports use the same queries as the screens; formulas are never repeated in the web app.
- Days and months are in the gym timezone (A-001).
- Revenue counts valid receipts; opening amounts of imported contracts are excluded from period revenue (D-011).
- Deleted records are excluded everywhere except the trash (D-035).
- Pending records (contracts, receipts, vouchers) are excluded from figures until approved (D-018).
- Session counts use the consume and credit flags stored on each session (T-050).
