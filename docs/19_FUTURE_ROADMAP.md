# 19 — Future Roadmap

Items after phase 1 (D-013). The data model is split per module so each can be added without rewriting the core (brief §1).

| Area | Notes |
|---|---|
| Fingerprint / device check-in | The scan API, the pairing rules (15 minutes, ±1 hour), the raw scans, and the machine user codes are built in M5 (D-069 to D-072); attaching a machine is OQ-027, after the survey TS-009. Devices authenticate with scoped API keys (`26_TECH_PROPOSAL.md` §5). |
| Member mobile app | Uses the same `/api/v1` with token authentication (T-043, T-044). |
| Pro Shop, lockers, towels | Retail and inventory modules of the ERP. |
| Loyalty contracts and points, day passes | New contract and service types. |
| Zalo OA | Not used for customer notifications (D-036); Zalo stays a lead intake channel (D-044). |
| Tax accounting, e-invoices | The cash book is internal; exports feed the accounting software (D-034). |
| HR and payroll | Builds on employees, PT credits, and payouts (D-032). |
| Further ERP modules | Same monorepo and API conventions (T-041). |

Inside phase 1 but late: lead channel APIs (milestone 10) and AI-assisted consulting audit (milestone 11). See `16_IMPLEMENTATION_PLAN.md`.
